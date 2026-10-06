import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { makeMockTransport, jsonResponse, bodyOf, type MockTransport } from "./helpers.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import * as fx from "./fixtures.js";
import { DestatisValidationError } from "../src/client/errors.js";
import { GUEST_WITH_CREDENTIALS_PROBLEM, NO_CREDENTIALS_PROBLEM, TOKEN_WITH_LOGIN_PROBLEM } from "../src/client/validate.js";

function client(
  responder: (req: HttpRequest) => HttpResponse,
  options: Omit<DestatisClientOptions, "transport"> = {},
): { c: DestatisClient; mt: MockTransport } {
  const mt = makeMockTransport(responder);
  const c = new DestatisClient({ ...options, transport: mt.transport });
  return { c, mt };
}

test("whoami is an unauthenticated GET and sends no credential headers", async () => {
  const { c, mt } = client(() => jsonResponse(fx.whoami), { token: "TOK" });
  await c.whoami();
  const req = mt.last();
  assert.equal(req.method, "GET");
  assert.equal(new URL(req.url).pathname, "/genesisWS/rest/2020/helloworld/whoami");
  assert.equal(req.headers?.["username"], undefined);
});

test("token mode puts the token in the username header and sends no password", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { token: "0123456789abcdef" });
  await c.catalogue.tables({ selection: "124*" });
  const req = mt.last();
  assert.equal(req.method, "POST");
  assert.equal(req.headers?.["username"], "0123456789abcdef");
  assert.equal(req.headers?.["password"], undefined);
  assert.equal(bodyOf(req).get("selection"), "124*");
  assert.equal(new URL(req.url).pathname, "/genesisWS/rest/2020/catalogue/tables");
});

test("username+password mode sends both credential headers", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), {
    username: "USER123456",
    password: "PASSWORD01",
  });
  await c.catalogue.statistics({});
  assert.equal(mt.last().headers?.["username"], "USER123456");
  assert.equal(mt.last().headers?.["password"], "PASSWORD01");
});

test("a token together with a username or password is refused, naming no value", () => {
  for (const login of [{ username: "USER123456", password: "PASSWORD01" }, { username: "USER123456" }, { password: "PASSWORD01" }]) {
    assert.throws(
      () => new DestatisClient({ token: "THETOKEN", ...login, transport: async () => jsonResponse({}) }),
      (err) =>
        err instanceof DestatisValidationError &&
        err.message === `Invalid credentials: ${TOKEN_WITH_LOGIN_PROBLEM}` &&
        !/THETOKEN|USER123456|PASSWORD01/.test(err.message),
      JSON.stringify(login),
    );
  }
  // A blank token is unset, so it doesn't conflict.
  assert.doesNotThrow(() => new DestatisClient({ token: " ", username: "USER123456", password: "PASSWORD01", transport: async () => jsonResponse({}) }));
});

test("find posts term and category in the body to find/find", async () => {
  const { c, mt } = client(() => jsonResponse(fx.findResult), { token: "T" });
  await c.find({ term: "Bevölkerung", category: "tables" });
  const req = mt.last();
  assert.equal(new URL(req.url).pathname, "/genesisWS/rest/2020/find/find");
  assert.equal(bodyOf(req).get("term"), "Bevölkerung");
  assert.equal(bodyOf(req).get("category"), "tables");
});

test("metadata.table posts the object name to metadata/table", async () => {
  const { c, mt } = client(() => jsonResponse(fx.metadataTable), { token: "T" });
  await c.metadata.table("12411-0001");
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/metadata/table");
  assert.equal(bodyOf(mt.last()).get("name"), "12411-0001");
});

test("data.table posts name and selection filters to data/table", async () => {
  const { c, mt } = client(() => jsonResponse(fx.dataTable), { token: "T" });
  await c.data.table("12411-0001", { startyear: "2020", classifyingvariable1: "DLAND" });
  const body = bodyOf(mt.last());
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/data/table");
  assert.equal(body.get("name"), "12411-0001");
  assert.equal(body.get("startyear"), "2020");
  assert.equal(body.get("classifyingvariable1"), "DLAND");
});

test("data.tableFile posts to the file endpoint and returns raw bytes", async () => {
  const zip = Buffer.from([0x50, 0x4b]);
  const { c, mt } = client(
    () => ({ status: 200, headers: { "content-type": "application/zip" }, body: zip }),
    { token: "T" },
  );
  const res = await c.data.tableFile("12411-0001", { format: "ffcsv" });
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/data/tablefile");
  assert.equal(bodyOf(mt.last()).get("format"), "ffcsv");
  assert.deepEqual(res.data, zip);
});

test("a non-blank credential is sent exactly as given, never trimmed", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { username: "u", password: "pass with spaces" });
  await c.catalogue.tables({});
  assert.equal(mt.last().headers?.["password"], "pass with spaces");
});

test("a credential with surrounding whitespace is rejected, never trimmed or sent", () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  assert.throws(
    () => new DestatisClient({ username: "u", password: "pass with spaces ", transport: mt.transport }),
    (err) =>
      err instanceof DestatisValidationError &&
      err.message === "Invalid password: Value has leading or trailing whitespace, which an HTTP header cannot carry.",
  );
  assert.equal(mt.calls.length, 0);
});

test("the access mode is explicit: credentials or guest: true, never neither, never both", () => {
  const t = async () => jsonResponse({});
  for (const options of [{}, { token: "" }, { token: "   " }, { username: " ", password: "" }]) {
    assert.throws(
      () => new DestatisClient({ ...options, transport: t }),
      (err) => err instanceof DestatisValidationError && err.message === `Invalid credentials: ${NO_CREDENTIALS_PROBLEM}`,
      JSON.stringify(options),
    );
  }
  for (const options of [{ token: "TOK" }, { username: "user" }, { password: "pass" }, { username: "user", password: "pass" }]) {
    assert.throws(
      () => new DestatisClient({ ...options, guest: true, transport: t }),
      (err) => err instanceof DestatisValidationError && err.message === `Invalid credentials: ${GUEST_WITH_CREDENTIALS_PROBLEM}`,
      JSON.stringify(options),
    );
  }
  for (const guest of ["yes", 1, null]) {
    assert.throws(() => new DestatisClient({ guest: guest as never, transport: t }), DestatisValidationError);
  }
  assert.doesNotThrow(() => new DestatisClient({ guest: true, transport: t }));
  assert.doesNotThrow(() => new DestatisClient({ guest: false, token: "TOK", transport: t }));
});

test("a guest client finds without credential headers and calls whoami", async () => {
  const { c, mt } = client((req) => jsonResponse(req.url.endsWith("/whoami") ? fx.whoami : fx.findResult), { guest: true });
  await c.find({ term: "Bev" });
  assert.equal(mt.last().headers?.["username"], undefined);
  await c.whoami();
  assert.equal(mt.calls.length, 2);
});

test("a blank token is treated as unset (no credential header)", async () => {
  const { c, mt } = client(() => jsonResponse(fx.findResult), { token: "   ", guest: true });
  await c.find({ term: "Bev" });
  assert.equal(mt.last().headers?.["username"], undefined);
});

test("account-only endpoints reject without credentials, before any request", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { token: "   ", guest: true });
  const calls: Array<() => Promise<unknown>> = [
    () => c.logincheck(),
    () => c.catalogue.tables(),
    () => c.metadata.statistic("12411"),
    () => c.data.timeseries("12411BJ001"),
    () => c.data.resultFile("R1"),
  ];
  for (const call of calls) {
    await assert.rejects(call(), (err) =>
      err instanceof DestatisValidationError && /^Invalid credentials: This endpoint needs an account/.test(err.message),
    );
  }
  assert.equal(mt.calls.length, 0);
});

test("a client with a custom transport rejects a non-http(s) base URL before sending credentials", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => jsonResponse(fx.whoami));
    assert.throws(
      () => new DestatisClient({ baseUrl, username: "USER", password: "PASS", transport: mt.transport }),
      (err) => err instanceof DestatisValidationError && /^Invalid baseUrl: Only "http:" and "https:"/.test(err.message),
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("text parameters and object codes are sent in Unicode NFC (P11)", async () => {
  const nfd = "Bevölkerung";
  const mt = makeMockTransport(() => jsonResponse(fx.findResult));
  const c = new DestatisClient({ token: "0123456789abcdef0123456789abcdef", transport: mt.transport });
  await c.find({ term: nfd });
  assert.equal(bodyOf(mt.last()).get("term"), "Bevölkerung");
  await c.catalogue.tables({ selection: `${nfd}*` }).catch(() => undefined);
  assert.equal(bodyOf(mt.last()).get("selection"), "Bevölkerung*");
  await c.metadata.table(nfd).catch(() => undefined);
  assert.equal(bodyOf(mt.last()).get("name"), "Bevölkerung");
});
