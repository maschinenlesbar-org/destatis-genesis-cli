import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { makeMockTransport, jsonResponse, bodyOf, type MockTransport } from "./helpers.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import * as fx from "./fixtures.js";

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

test("a token takes precedence over username/password", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), {
    token: "THETOKEN",
    username: "USER123456",
    password: "PASSWORD01",
  });
  await c.catalogue.tables({});
  assert.equal(mt.last().headers?.["username"], "THETOKEN");
  assert.equal(mt.last().headers?.["password"], undefined);
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

test("a blank token is treated as unset (no credential header)", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { token: "   " });
  await c.catalogue.tables({});
  assert.equal(mt.last().headers?.["username"], undefined);
});
