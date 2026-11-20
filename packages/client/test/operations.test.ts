// The skills' use cases as library functions (src/operations.ts), with the traps the skills
// document as test cases. Every answer comes from test/recorded.ts; nothing reaches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient } from "../src/client.js";
import { DestatisApiError, DestatisParseError, DestatisValidationError } from "../src/errors.js";
import type { HttpRequest, HttpResponse } from "../src/http.js";
import { browseCatalogue, describeObject, fetchData, findStatistics, germanNumber, getFlatTable, splitCsvLine } from "../src/operations.js";
import { readZip } from "../src/zip.js";
import { bodyOf, jsonResponse, makeMockTransport, rawResponse } from "./helpers.js";
import {
  DATA_12411_0001,
  DATA_SYMBOLS,
  EMPTY_104,
  FFCSV_12411_0001,
  FIND_ALL,
  FIND_NONE,
  FIND_TABLES,
  METADATA_12411_0001,
  TABLES_12411,
  zipOf,
} from "./recorded.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** A client whose requests `answer` answers by endpoint (the path after /2020/). */
function clientFor(answer: (endpoint: string, request: HttpRequest) => HttpResponse) {
  const upstream = makeMockTransport((request) => answer(new URL(request.url).pathname.replace(/^.*\/rest\/2020\//, ""), request));
  return { client: new DestatisClient({ token: TOKEN, transport: upstream.transport, maxRetries: 0 }), upstream };
}

const endpoints = (calls: readonly HttpRequest[]) => calls.map((request) => new URL(request.url).pathname.replace(/^.*\/rest\/2020\//, ""));

test("germanNumber: thousands dots and a decimal comma; keys with a leading zero, dates and plain-dot decimals stay text", () => {
  assert.equal(germanNumber("84.669.326"), 84669326);
  assert.equal(germanNumber("1.234,5"), 1234.5);
  assert.equal(germanNumber("-0,8"), -0.8);
  assert.equal(germanNumber("2023"), 2023);
  assert.equal(germanNumber("0"), 0);
  for (const text of ["01", "0100", "31.12.2023", "1.5", "12411-0001", "...", "-", ".", "x", "", "1.23", "1,2,3"]) assert.equal(germanNumber(text), undefined, text);
});

test("splitCsvLine: semicolons, quoted cells with the delimiter and doubled quotes", () => {
  assert.deepEqual(splitCsvLine(";Anzahl;"), ["", "Anzahl", ""]);
  assert.deepEqual(splitCsvLine('a;"b;c";"say ""hi"""'), ["a", "b;c", 'say "hi"']);
  assert.deepEqual(splitCsvLine("a,b", ","), ["a", "b"]);
});

test("fetchData: the CSV inside Object.Content is decoded line by line, German numbers as numbers", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(DATA_12411_0001));
  const result = await fetchData(client, { code: "12411-0001", startYear: "2020", endYear: "2023" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.searched, { startYear: "2020", endYear: "2023" });
  assert.deepEqual(result.lines[9], ["31.12.2023", 84669326, ""]);
  assert.deepEqual(result.lines[0], ["GENESIS-Tabelle: 12411-0001"]);
  assert.equal(result.total, 12);
  assert.match(result.copyright, /Statistisches Bundesamt/);
  const body = bodyOf(upstream.last());
  assert.equal(body.get("name"), "12411-0001");
  assert.equal(body.get("startyear"), "2020");
  assert.equal(body.get("endyear"), "2023");
  assert.deepEqual(endpoints(upstream.calls), ["data/table"]);
});

test("fetchData: value symbols stay text and are named, never 0; a key like 01 stays text", async () => {
  const { client } = clientFor(() => jsonResponse(DATA_SYMBOLS));
  const result = await fetchData(client, { code: "12613-0002" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.lines[1], ["Schleswig-Holstein", "01", 1234.5, "..."]);
  assert.deepEqual(result.lines[2], ["Hamburg", "02", "-", "."]);
  assert.deepEqual(Object.keys(result.symbols).sort(), ["-", ".", "...", "/", "x"]);
  assert.match(result.symbols["."] ?? "", /unknown or kept secret/);
});

test("fetchData: lines are paged by offset and limit; total counts them all", async () => {
  const { client } = clientFor(() => jsonResponse(DATA_12411_0001));
  const result = await fetchData(client, { code: "12411-0001", offset: 6, limit: 2 });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.offset, 6);
  assert.equal(result.total, 12);
  assert.deepEqual(result.lines.map((line) => line[0]), ["31.12.2020", "31.12.2021"]);
});

test("fetchData: Status 104 for a code that doesn't exist is empty, 'no such code', checked against the metadata", async () => {
  const { client, upstream } = clientFor((endpoint) => jsonResponse(EMPTY_104(...(endpoint.split("/") as [string, string]))));
  const result = await fetchData(client, { code: "99999-9999" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /no table with the code 99999-9999/);
  assert.deepEqual(endpoints(upstream.calls), ["data/table", "metadata/table"]);
});

test("fetchData: Status 104 for a code that exists means the selection excluded everything", async () => {
  const { client } = clientFor((endpoint) => (endpoint === "metadata/table" ? jsonResponse(METADATA_12411_0001) : jsonResponse(EMPTY_104("data", "table"))));
  const result = await fetchData(client, { code: "12411-0001", startYear: "1800", endYear: "1801" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /exists, but the selection excluded every value/);
  assert.deepEqual(result.searched, { startYear: "1800", endYear: "1801" });
});

test("fetchData: a saved result has no metadata: an empty one says both reasons, with no second request", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(EMPTY_104("data", "result")));
  const result = await fetchData(client, { kind: "result", code: "MYRESULT" });
  assert.equal(result.status, "empty");
  assert.deepEqual(endpoints(upstream.calls), ["data/result"]);
});

test("fetchData: too large (Status 98) is the client's error, with the code", async () => {
  const tooLarge = clientFor(() =>
    jsonResponse({ ...DATA_12411_0001, Status: { Code: 98, Content: "Die Tabelle ist zu groß für einen direkten Abruf.", Type: "Information" } }),
  );
  await assert.rejects(fetchData(tooLarge.client, { code: "12411-0005" }), (err: unknown) => err instanceof DestatisApiError && err.code === 98);
});

test("fetchData: classifying variables and keys, the region and contents go out as GENESIS's parameters", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(DATA_12411_0001));
  await fetchData(client, {
    code: "12411-0001",
    regionVariable: "DLAND",
    regionKey: "09,05",
    classes: [{ variable: "GES", key: "GESW" }, { variable: "ALTX20" }],
    contents: "BEVSTD",
    timeslices: 3,
    language: "en",
  });
  const body = bodyOf(upstream.last());
  assert.equal(body.get("regionalvariable"), "DLAND");
  assert.equal(body.get("regionalkey"), "09,05");
  assert.equal(body.get("classifyingvariable1"), "GES");
  assert.equal(body.get("classifyingkey1"), "GESW");
  assert.equal(body.get("classifyingvariable2"), "ALTX20");
  assert.equal(body.get("classifyingkey2"), null);
  assert.equal(body.get("contents"), "BEVSTD");
  assert.equal(body.get("timeslices"), "3");
  assert.equal(body.get("language"), "en");
});

test("fetchData: a wildcard code, a region key without its variable and a sixth class are refused before any request", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(DATA_12411_0001));
  await assert.rejects(fetchData(client, { code: "12411*" }), (err: unknown) => err instanceof DestatisValidationError && /exact/.test(err.message));
  await assert.rejects(fetchData(client, { code: "12411-0001", regionKey: "09" }), /regional variable/);
  const six = Array.from({ length: 6 }, (_, i) => ({ variable: `V${i}` }));
  await assert.rejects(fetchData(client, { code: "12411-0001", classes: six }), /at most five/);
  await assert.rejects(fetchData(client, { code: "12411-0001", limit: 1001 }), DestatisValidationError);
  assert.equal(upstream.calls.length, 0);
});

test("findStatistics: tables by default; titles on one line; Valid and the empty Time left out", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(FIND_TABLES));
  const result = await findStatistics(client, { term: "Bevölkerung", limit: 5 });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.matches.length, 5);
  assert.deepEqual(result.matches[2], {
    type: "table",
    code: "12211-0003",
    title: "Bevölkerung, Erwerbstätige, Erwerbslose, Erwerbspersonen, Nichterwerbspersonen aus Hauptwohnsitzhaush.: Deutschland, Jahre, Geschlecht, Größenkl. persönl. monatl. Nettoeinkommen",
  });
  const body = bodyOf(upstream.last());
  assert.equal(body.get("category"), "tables");
  assert.equal(body.get("pagelength"), "5");
});

test("findStatistics: category all collects every list; counts that come as strings are numbers", async () => {
  const { client } = clientFor(() => jsonResponse(FIND_ALL));
  const result = await findStatistics(client, { term: "Bevölkerungsstand", category: "all", limit: 2 });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.matches.map((m) => `${m.type} ${m.code}`),
    ["table 12411-0001", "table 12411-0002", "statistic 12411", "statistic 12421", "variable BEV050", "variable BEVSTD"],
  );
  assert.equal(result.matches.find((m) => m.code === "12411")?.cubes, 28);
  assert.equal(result.matches.find((m) => m.code === "BEVSTD")?.values, -1);
  assert.equal(result.matches.find((m) => m.code === "BEVSTD")?.variableType, "Wert");
});

test("findStatistics: no hit is success with every list null: empty, with what was searched", async () => {
  const { client } = clientFor(() => jsonResponse(FIND_NONE));
  const result = await findStatistics(client, { term: "Xyzzyquux" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.deepEqual(result.searched, { term: "Xyzzyquux", category: "tables" });
  assert.match(result.reason, /category all/);
});

test("findStatistics: a decomposed umlaut is sent composed (NFC)", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(FIND_TABLES));
  await findStatistics(client, { term: "Bevölkerung " });
  assert.equal(bodyOf(upstream.last()).get("term"), "Bevölkerung");
});

test("browseCatalogue: a code pattern lists the matching tables; complete when under the limit", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(TABLES_12411));
  const result = await browseCatalogue(client, { selection: "12411*" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.items.length, 3);
  assert.equal(result.items[2]?.title, "Bevölkerung: Deutschland, Stichtag, Altersjahre");
  assert.equal(result.items[0]?.time, "31.12.1950-31.12.2023");
  assert.equal(result.complete, true);
  const body = bodyOf(upstream.last());
  assert.equal(body.get("selection"), "12411*");
  assert.equal(body.get("searchcriterion"), "Code");
  assert.equal(body.get("sortcriterion"), "Code");
  assert.deepEqual(endpoints(upstream.calls), ["catalogue/tables"]);
});

test("browseCatalogue: Status 104 with an empty list is empty; an exact code without * is told to add one", async () => {
  const { client } = clientFor(() => jsonResponse({ ...EMPTY_104("catalogue", "tables"), List: [] }));
  const result = await browseCatalogue(client, { selection: "12411" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /12411\*/);
});

test("browseCatalogue: a list as long as the limit is not complete (GENESIS has no paging)", async () => {
  const { client } = clientFor(() => jsonResponse(TABLES_12411));
  const result = await browseCatalogue(client, { selection: "12411*", limit: 3, searchIn: "code", sortBy: "title" });
  assert.equal(result.status === "ok" && result.complete, false);
});

test("describeObject: title, time span and the dimensions from the structure", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(METADATA_12411_0001));
  const result = await describeObject(client, { code: "12411-0001" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.title, "Bevölkerung: Deutschland, Stichtag");
  assert.deepEqual(result.timeSpan, { from: "31.12.1950", to: "31.12.2023" });
  assert.deepEqual(result.dimensions, [
    { code: "DINSG", title: "Deutschland insgesamt", role: "head", type: "Merkmal", values: 1 },
    { code: "BEVSTD", title: "Bevölkerungsstand", role: "column", type: "Wert", values: -1 },
    { code: "STAG", title: "Stichtag", role: "row", type: "Merkmal", values: 74 },
  ]);
  assert.deepEqual(endpoints(upstream.calls), ["metadata/table"]);
});

test("describeObject: a code that doesn't exist (Status 104, no Object) is empty, not an error", async () => {
  const { client } = clientFor(() => jsonResponse(EMPTY_104("metadata", "table")));
  const result = await describeObject(client, { code: "12411" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /Codes are exact/);
});

test("getFlatTable: the ffcsv download is unpacked from its ZIP and split into columns and rows", async () => {
  const { client, upstream } = clientFor(() => rawResponse(zipOf({ "12411-0001_flat.csv": FFCSV_12411_0001 }), "application/zip"));
  const result = await getFlatTable(client, { code: "12411-0001", startYear: "2022" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.file, "12411-0001_flat.csv");
  assert.equal(result.columns[9], "value");
  assert.equal(result.total, 2);
  assert.equal(result.rows[1]?.[9], "84669326");
  assert.equal(result.rows[1]?.[4], "2023-12-31");
  const body = bodyOf(upstream.last());
  assert.equal(body.get("format"), "ffcsv");
  assert.equal(body.get("startyear"), "2022");
  assert.deepEqual(endpoints(upstream.calls), ["data/tablefile"]);
});

test("getFlatTable: a Latin-1 file is decoded; a stored (uncompressed) entry and paging work", async () => {
  const latin1 = Buffer.from("code;label\n1;Bevölkerung\n2;Größe\n", "latin1");
  const { client } = clientFor(() => rawResponse(zipOf({ "t.csv": latin1 }, { stored: true }), "application/zip"));
  const result = await getFlatTable(client, { code: "12411-0001", offset: 1, limit: 1 });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.rows, [["2", "Größe"]]);
  assert.equal(result.total, 2);
});

test("getFlatTable: a download that finds nothing (Status 104 instead of a file) is empty, with the reason", async () => {
  const { client } = clientFor((endpoint) => (endpoint === "metadata/table" ? jsonResponse(METADATA_12411_0001) : jsonResponse(EMPTY_104("data", "tablefile"))));
  const result = await getFlatTable(client, { code: "12411-0001", startYear: "1800" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /selection excluded every value/);
});

test("readZip: an entry larger than the cap, an encrypted entry and something that isn't a ZIP are parse errors", () => {
  assert.throws(() => readZip(zipOf({ "big.csv": "x".repeat(2000) }), 1000), (err: unknown) => err instanceof DestatisParseError && /more than this client reads/.test(err.message));
  const encrypted = zipOf({ "a.csv": "a" });
  encrypted.writeUInt16LE(0x801, encrypted.length - 22 - 46 - 5 + 8);
  assert.throws(() => readZip(encrypted), /encrypted/);
  assert.throws(() => readZip(Buffer.from("PK\u0003\u0004 not really")), DestatisParseError);
  assert.deepEqual(readZip(zipOf({ "dir/": "", "a.csv": "a;b" })).map((e) => e.name), ["a.csv"]);
});

test("fetchData: GENESIS's 'object not found' (Status 90) is empty too, naming the code", async () => {
  const { client } = clientFor(() => jsonResponse({ ...EMPTY_104("data", "table"), Status: { Code: 90, Content: "Der angeforderte Wert wurde nicht gefunden.", Type: "Fehler" } }));
  const result = await fetchData(client, { code: "12411-9999" });
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.match(result.reason, /no table with the code 12411-9999/);
});

test("a refused login is never 'nothing found': wrong credentials (HTTP 404 with GENESIS code 2) stay the client's error", async () => {
  const bad = { Code: 2, Content: "Ein Fehler ist aufgetreten. (Bitte prüfen und korrigieren Sie Ihren Nutzernamen oder Ihren Token bzw. das Passwort.)", Type: "ERROR" };
  const { client } = clientFor(() => jsonResponse(bad, 404));
  await assert.rejects(fetchData(client, { code: "12411-0001" }), (err: unknown) => err instanceof DestatisApiError && err.isAuthError);
  await assert.rejects(getFlatTable(client, { code: "12411-0001" }), (err: unknown) => err instanceof DestatisApiError && err.isAuthError);
  await assert.rejects(describeObject(client, { code: "12411-0001" }), (err: unknown) => err instanceof DestatisApiError && err.isAuthError);
});
