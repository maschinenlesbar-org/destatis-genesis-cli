import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine, redactUrl } from "../src/client/engine.js";
import { DestatisApiError, DestatisParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse, bodyOf } from "./helpers.js";
import * as fx from "./fixtures.js";

// Built via char codes so no raw control bytes ever appear in this source file.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

test("buildUrl normalises the path (parameters travel in the body)", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/" });
  assert.equal(e.buildUrl("api/"), "https://example.test/api/");
  assert.equal(e.buildUrl("/x"), "https://example.test/x");
});

test("postJson sends POST with credential headers and a form-urlencoded body", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  const e = new RequestEngine({ transport: mt.transport });
  await e.postJson("/catalogue/tables", { selection: "124*", pagelength: 2 }, { username: "TOK" });
  const req = mt.last();
  assert.equal(req.method, "POST");
  assert.equal(req.headers?.["username"], "TOK");
  assert.equal(req.headers?.["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
  const body = bodyOf(req);
  assert.equal(body.get("selection"), "124*");
  assert.equal(body.get("pagelength"), "2");
  // The URL carries no query string / no credentials.
  assert.equal(new URL(req.url).search, "");
});

test("Content-Length is set even for an empty POST body (avoids GENESIS 411)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.loginOk));
  const e = new RequestEngine({ transport: mt.transport });
  await e.postJson("/helloworld/logincheck", {}, { username: "TOK" });
  assert.equal(mt.last().headers?.["Content-Length"], "0");
});

test("getJson performs an unauthenticated GET (whoami)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.whoami));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/helloworld/whoami"), fx.whoami);
  assert.equal(mt.last().method, "GET");
  assert.equal(mt.last().headers?.["username"], undefined);
});

test("postJson throws DestatisParseError on invalid JSON", async () => {
  const mt = makeMockTransport(() => rawResponse("not json", "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => e.postJson("/x", {}, {}), DestatisParseError);
});

test("surfaces a logical error (Status.Type Fehler) despite HTTP 200", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.genericError)); // HTTP 200
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/x", {}, {}),
    (err) => err instanceof DestatisApiError && err.code === -1 && err.httpStatus === undefined,
  );
});

test("maps Status.Code 90 to a not-found error", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.notFound));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/x", {}, {}),
    (err) => err instanceof DestatisApiError && err.code === 90 && err.isNotFound,
  );
});

test("explains Status.Code 98 (too large) with narrowing guidance", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tooLarge));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/x", {}, {}),
    (err) => err instanceof DestatisApiError && err.code === 98 && /narrow the selection/.test(err.message),
  );
});

test("treats Status.Code 104 as a valid empty result (no throw)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.emptyResult));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.postJson("/x", {}, {}), fx.emptyResult);
});

test("returns normally on a warning (Status.Code 22)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.warning));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.postJson("/x", {}, {}), fx.warning);
});

test("a 503 is retried up to maxRetries then surfaces as an HTTP DestatisApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "busy" }, 503);
  });
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(
    () => e.postJson("/x", {}, {}),
    (err) => err instanceof DestatisApiError && err.httpStatus === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("a 3xx is NOT followed (would forward credential headers) and surfaces as an error", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return { status: 307, headers: { location: "https://genesis.destatis.de/x" }, body: Buffer.alloc(0) };
  });
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/x", {}, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && err.httpStatus === 307 && /canonical host/.test(err.message),
  );
  assert.equal(calls, 1); // never followed the redirect
});

test("surfaces a non-JSON (plain-text) HTTP error body as the error detail", async () => {
  const mt = makeMockTransport(() =>
    rawResponse('Cannot read the array length because "pDirectory" is null', "text/plain", 500),
  );
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/find/find", {}, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && err.httpStatus === 500 && /pDirectory/.test(err.message),
  );
});

test("strips terminal control characters from a plain-text error detail (GEN-03)", async () => {
  const hostile = `boom${ESC}[31m${BEL} injected`;
  const mt = makeMockTransport(() => rawResponse(hostile, "text/plain", 500));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/find/find", {}, { username: "TOK" }),
    (err) => {
      assert.ok(err instanceof DestatisApiError);
      assert.ok(!err.message.includes(ESC), "ESC survived into the message");
      assert.ok(!err.message.includes(BEL), "BEL survived into the message");
      assert.match(err.message, /boom.*injected/);
      return true;
    },
  );
});

test("strips terminal control characters from a logical Status.Content (GEN-03)", async () => {
  const body = { Status: { Code: 90, Type: "Fehler", Content: `clean${ESC}text` } };
  const mt = makeMockTransport(() => jsonResponse(body));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/x", {}, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && !err.message.includes(ESC) && /cleantext/.test(err.message),
  );
});

test("strips terminal control characters from the echoed Content-Type (GEN-03)", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const mt = makeMockTransport(() => rawResponse(zip, `application/zip${ESC}[31m`));
  const e = new RequestEngine({ transport: mt.transport });
  const res = await e.postRaw("/data/tablefile", "application/zip", { name: "1" }, { username: "TOK" });
  assert.ok(!res.contentType.includes(ESC));
  assert.equal(res.contentType, "application/zip[31m");
});

test("does not surface an HTML error page as the detail (noise)", async () => {
  const mt = makeMockTransport(() => rawResponse("<html><body>502 Bad Gateway</body></html>", "text/html", 502));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postJson("/find/find", {}, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && err.httpStatus === 502 && err.detail === undefined,
  );
});

test("the User-Agent and Accept headers are sent", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  const e = new RequestEngine({ transport: mt.transport, userAgent: "ua/1" });
  await e.postJson("/x", {}, {});
  assert.equal(mt.last().headers?.["User-Agent"], "ua/1");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("postRaw returns the bytes for a binary download", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
  const mt = makeMockTransport(() => rawResponse(zip, "application/zip"));
  const e = new RequestEngine({ transport: mt.transport });
  const res = await e.postRaw("/data/tablefile", "application/zip", { name: "1" }, { username: "TOK" });
  assert.deepEqual(res.data, zip);
});

test("postRaw surfaces a JSON logical error served on a file endpoint", async () => {
  const mt = makeMockTransport(() => rawResponse(JSON.stringify(fx.notFound), "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.postRaw("/data/tablefile", "application/zip", { name: "1" }, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && err.code === 90,
  );
});

test("redactUrl masks username and password query parameters", () => {
  const masked = redactUrl("https://genesis.destatis.de/x?name=1&username=SECRET&password=HUNTER2");
  assert.match(masked, /username=%2A%2A%2A|username=\*\*\*/);
  assert.doesNotMatch(masked, /SECRET|HUNTER2/);
});

test("redactUrl masks URL userinfo (basic-auth credentials in the base URL)", () => {
  const masked = redactUrl("https://SECRETUSER:HUNTER2@genesis.destatis.de/x?name=1");
  assert.doesNotMatch(masked, /SECRETUSER|HUNTER2/);
  // The host and path survive; only the credentials are scrubbed.
  assert.match(masked, /genesis\.destatis\.de\/x/);
});

test("a base URL with embedded userinfo does not leak into the error message", async () => {
  const mt = makeMockTransport(() => rawResponse("nope", "text/plain", 500));
  const e = new RequestEngine({
    baseUrl: "https://SECRETUSER:HUNTER2@genesis.destatis.de",
    transport: mt.transport,
  });
  await assert.rejects(
    () => e.postJson("/find/find", {}, { username: "TOK" }),
    (err) => err instanceof DestatisApiError && !/SECRETUSER|HUNTER2/.test(err.message),
  );
});
