import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine, redactUrl } from "../src/client/engine.js";
import { DestatisApiError, DestatisParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import * as fx from "./fixtures.js";

test("buildUrl normalises the path and appends the query", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/" });
  assert.equal(e.buildUrl("api/"), "https://example.test/api/");
  assert.equal(e.buildUrl("/x", { a: "1", b: ["2", "3"] }), "https://example.test/x?a=1&b=2&b=3");
});

test("getJson parses a successful (Status.Code 0) envelope", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), fx.tablesList);
});

test("getJson throws DestatisParseError on invalid JSON", async () => {
  const mt = makeMockTransport(() => rawResponse("not json", "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => e.getJson("/x"), DestatisParseError);
});

test("getJson surfaces a logical error (Status.Type Fehler) despite HTTP 200", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.genericError)); // HTTP 200
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof DestatisApiError && err.code === -1 && err.httpStatus === undefined,
  );
});

test("getJson maps Status.Code 90 to a not-found error", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.notFound));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof DestatisApiError && err.code === 90 && err.isNotFound,
  );
});

test("getJson explains Status.Code 98 (too large) with narrowing guidance", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tooLarge));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof DestatisApiError && err.code === 98 && /narrow the selection/.test(err.message),
  );
});

test("getJson treats Status.Code 104 as a valid empty result (no throw)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.emptyResult));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), fx.emptyResult);
});

test("getJson returns normally on a warning (Status.Code 22)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.warning));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), fx.warning);
});

test("getJson does not inspect a body without a Status object (helloworld)", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.whoami));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), fx.whoami);
});

test("a 503 is retried up to maxRetries then surfaces as an HTTP DestatisApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "busy" }, 503);
  });
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof DestatisApiError && err.httpStatus === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("a retried request that then succeeds resolves", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? jsonResponse({}, 503) : jsonResponse(fx.tablesList);
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {} });
  assert.deepEqual(await e.getJson("/x"), fx.tablesList);
  assert.equal(calls, 2);
});

test("a 3xx is NOT followed (credentials ride in the URL) and surfaces as an error", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return { status: 302, headers: { location: "https://evil.example/collect" }, body: Buffer.alloc(0) };
  });
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof DestatisApiError && err.httpStatus === 302,
  );
  assert.equal(calls, 1); // never followed the redirect
});

test("the User-Agent and Accept headers are sent", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  const e = new RequestEngine({ transport: mt.transport, userAgent: "ua/1" });
  await e.getJson("/x");
  assert.equal(mt.last().headers?.["User-Agent"], "ua/1");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("getRaw returns the bytes for a binary download", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
  const mt = makeMockTransport(() => rawResponse(zip, "application/zip"));
  const e = new RequestEngine({ transport: mt.transport });
  const res = await e.getRaw("/data/tablefile", "application/zip", {});
  assert.deepEqual(res.data, zip);
});

test("getRaw surfaces a JSON logical error served on a file endpoint", async () => {
  const mt = makeMockTransport(() => rawResponse(JSON.stringify(fx.notFound), "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getRaw("/data/tablefile", "application/zip", {}),
    (err) => err instanceof DestatisApiError && err.code === 90,
  );
});

test("redactUrl masks username and password query parameters", () => {
  const masked = redactUrl("https://www-genesis.destatis.de/x?name=1&username=SECRET&password=HUNTER2");
  assert.match(masked, /username=%2A%2A%2A|username=\*\*\*/);
  assert.doesNotMatch(masked, /SECRET|HUNTER2/);
});
