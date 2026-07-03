import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { makeMockTransport, jsonResponse, queryOf, type MockTransport } from "./helpers.js";
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

test("whoami hits helloworld/whoami and sends NO credentials", async () => {
  const { c, mt } = client(() => jsonResponse(fx.whoami), { token: "TOK" });
  await c.whoami();
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/genesisWS/rest/2020/helloworld/whoami");
  assert.equal(url.searchParams.get("username"), null);
  assert.equal(url.searchParams.get("password"), null);
});

test("token mode places the token in the username field and sends no password", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { token: "0123456789abcdef" });
  await c.catalogue.tables({ selection: "124*" });
  const q = queryOf(mt.last());
  assert.equal(q.get("username"), "0123456789abcdef");
  assert.equal(q.get("password"), null);
  assert.equal(q.get("selection"), "124*");
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/catalogue/tables");
});

test("username+password mode sends both credentials", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), {
    username: "USER123456",
    password: "PASSWORD01",
  });
  await c.catalogue.statistics({});
  const q = queryOf(mt.last());
  assert.equal(q.get("username"), "USER123456");
  assert.equal(q.get("password"), "PASSWORD01");
});

test("a token takes precedence over username/password", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), {
    token: "THETOKEN",
    username: "USER123456",
    password: "PASSWORD01",
  });
  await c.catalogue.tables({});
  const q = queryOf(mt.last());
  assert.equal(q.get("username"), "THETOKEN");
  assert.equal(q.get("password"), null);
});

test("find hits find/find with the term and category", async () => {
  const { c, mt } = client(() => jsonResponse(fx.findResult), { token: "T" });
  await c.find({ term: "Bevölkerung", category: "tables" });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/genesisWS/rest/2020/find/find");
  assert.equal(url.searchParams.get("term"), "Bevölkerung");
  assert.equal(url.searchParams.get("category"), "tables");
});

test("metadata.table hits metadata/table with the object name", async () => {
  const { c, mt } = client(() => jsonResponse(fx.metadataTable), { token: "T" });
  await c.metadata.table("12411-0001");
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/genesisWS/rest/2020/metadata/table");
  assert.equal(url.searchParams.get("name"), "12411-0001");
});

test("data.table hits data/table with name and selection filters", async () => {
  const { c, mt } = client(() => jsonResponse(fx.dataTable), { token: "T" });
  await c.data.table("12411-0001", { startyear: "2020", classifyingvariable1: "DLAND" });
  const q = queryOf(mt.last());
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/data/table");
  assert.equal(q.get("name"), "12411-0001");
  assert.equal(q.get("startyear"), "2020");
  assert.equal(q.get("classifyingvariable1"), "DLAND");
});

test("data.tableFile requests the file endpoint and returns raw bytes", async () => {
  const zip = Buffer.from([0x50, 0x4b]);
  const { c, mt } = client(
    () => ({ status: 200, headers: { "content-type": "application/zip" }, body: zip }),
    { token: "T" },
  );
  const res = await c.data.tableFile("12411-0001", { format: "ffcsv" });
  assert.equal(new URL(mt.last().url).pathname, "/genesisWS/rest/2020/data/tablefile");
  assert.equal(queryOf(mt.last()).get("format"), "ffcsv");
  assert.deepEqual(res.data, zip);
});

test("a blank token is treated as unset (no credentials sent)", async () => {
  const { c, mt } = client(() => jsonResponse(fx.tablesList), { token: "   " });
  await c.catalogue.tables({});
  assert.equal(queryOf(mt.last()).get("username"), null);
});
