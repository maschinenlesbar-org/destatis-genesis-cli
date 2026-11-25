// The skills' use cases as library functions (src/operations.ts), with the traps the skills
// document as test cases. Every answer comes from test/recorded.ts; nothing reaches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient } from "../src/client.js";
import { DestatisApiError, DestatisParseError, DestatisValidationError } from "../src/errors.js";
import type { HttpRequest, HttpResponse } from "../src/http.js";
import { browseCatalogue, describeObject, fetchData, findStatistics, germanNumber, getFlatTable, splitCsvLine } from "../src/operations.js";
import { readZip, zipEntries } from "../src/zip.js";
import { bodyOf, jsonResponse, makeMockTransport, rawResponse } from "./helpers.js";
import {
  DATA_12411_0001,
  DATA_SYMBOLS,
  EMPTY_104,
  FFCSV_12411_0001,
  FIND_ALL,
  FIND_NONE,
  FIND_TABLES,
  genesis,
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

test("germanNumber: a figure with more digits than a number holds exactly stays text, never other digits", () => {
  assert.equal(germanNumber("9.007.199.254.740.991"), 9007199254740991, "the largest exact whole number");
  assert.equal(germanNumber("9.007.199.254.740.993"), undefined);
  assert.equal(germanNumber("12.345.678.901.234.567.890"), undefined);
  assert.equal(germanNumber("123.456.789.012,345"), 123456789012.345, "15 digits are exact");
  assert.equal(germanNumber("1.234.567.890.123,4567"), undefined, "17 digits with a fraction are not");
  assert.equal(germanNumber("0,000000000000000012345"), 1.2345e-17, "leading zeros of a fraction aren't digits of the figure");
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

test("titles from long runs of whitespace are put on one line in linear time, the same as before", async () => {
  const spaces = " ".repeat(60_000); // took seconds through the old pattern, quadratic in the run
  const items = [
    { Code: "12411-0001", Content: `Bevölkerung${spaces}x`, Time: "" },
    { Code: "12411-0002", Content: "a \n \n b\n Stichtag\n Gemeinden \n", Time: "" },
  ];
  const answer = { ...TABLES_12411, List: items };
  const started = Date.now();
  const result = await browseCatalogue(clientFor(() => jsonResponse(answer)).client, { selection: "12411*" });
  const meta = { ...METADATA_12411_0001, Object: { ...(METADATA_12411_0001.Object as Record<string, unknown>), Content: `Bevölkerung${spaces}x` } };
  const described = await describeObject(clientFor(() => jsonResponse(meta)).client, { code: "12411-0001" });
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.items[0]?.title, `Bevölkerung${spaces}x`);
  assert.equal(result.items[1]?.title, "a b Stichtag Gemeinden ");
  assert.equal(described.status, "ok");
  if (described.status !== "ok") return;
  assert.equal(described.title, `Bevölkerung${spaces}x`);
});

test("findStatistics: a type's list as long as the limit is not complete, as in browseCatalogue; under it, complete", async () => {
  const at = await findStatistics(clientFor(() => jsonResponse(FIND_TABLES)).client, { term: "Bevölkerung", limit: 5 });
  assert.equal(at.status, "ok");
  if (at.status !== "ok") return;
  assert.equal(at.complete, false);
  const under = await findStatistics(clientFor(() => jsonResponse(FIND_TABLES)).client, { term: "Bevölkerung", limit: 20 });
  assert.equal(under.status, "ok");
  if (under.status !== "ok") return;
  assert.equal(under.complete, true);
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

test("fetchData and getFlatTable: a start year after the end year is refused before any request", async () => {
  const { client, upstream } = clientFor(() => jsonResponse(DATA_12411_0001));
  await assert.rejects(fetchData(client, { code: "12411-0001", startYear: "2023", endYear: "2015" }), (err: unknown) => err instanceof DestatisValidationError && /startYear 2023 is after endYear 2015/.test(err.message));
  await assert.rejects(getFlatTable(client, { code: "12411-0001", startYear: "2023", endYear: "2015" }), DestatisValidationError);
  assert.equal(upstream.calls.length, 0);
  assert.equal((await fetchData(client, { code: "12411-0001", startYear: "2015", endYear: "2015" })).status, "ok");
});

test("fetchData: with language en the figures stay text as sent: GENESIS's English number format isn't known, so none is guessed", async () => {
  const english = { ...DATA_SYMBOLS, Object: { Code: "12613-0002", Content: "Land;Key;2023\nBerlin;11;3,878,100\nHamburg;02;162,273\nBremen;04;.\n" } };
  const { client } = clientFor(() => jsonResponse(english));
  const result = await fetchData(client, { code: "12613-0002", language: "en" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.lines.map((line) => line[2]), ["2023", "3,878,100", "162,273", "."]);
  assert.equal(result.symbols["."], "unknown or kept secret");
  const german = await fetchData(clientFor(() => jsonResponse(DATA_12411_0001)).client, { code: "12411-0001", language: "de" });
  assert.equal(german.status === "ok" && german.lines[9]?.[1], 84669326);
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

test("getFlatTable and fetchData: a line break inside a quoted cell stays in the cell, the row whole", async () => {
  const csv = 'statistics_code;statistics_label;value\r\n12411;"Bevölkerung:\nDeutschland; Stichtag";84669326\r\n12411;"zweite";5\r\n';
  const flat = clientFor(() => rawResponse(zipOf({ "t.csv": csv }), "application/zip"));
  const table = await getFlatTable(flat.client, { code: "12411-0001" });
  assert.equal(table.status, "ok");
  if (table.status !== "ok") return;
  assert.equal(table.total, 2);
  assert.deepEqual(table.rows, [["12411", "Bevölkerung:\nDeutschland; Stichtag", "84669326"], ["12411", "zweite", "5"]]);
  const data = clientFor(() => jsonResponse(genesis("data", "table", { Object: { Code: "12411-0001", Content: csv } })));
  const lines = await fetchData(data.client, { code: "12411-0001" });
  assert.equal(lines.status, "ok");
  if (lines.status !== "ok") return;
  assert.equal(lines.total, 3);
  assert.deepEqual(lines.lines[1], [12411, "Bevölkerung:\nDeutschland; Stichtag", 84669326]);
});

test("getFlatTable: a quote that never closes doesn't swallow the rest of the file: the lines are split as they come", async () => {
  const { client } = clientFor(() => rawResponse(zipOf({ "t.csv": 'code;label\n1;"open\n2;b\n3;c\n' }), "application/zip"));
  const result = await getFlatTable(client, { code: "12411-0001" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.total, 3);
  assert.deepEqual(result.rows[2], ["3", "c"]);
});

test("getFlatTable: a file that isn't UTF-8 is read as Windows-1252, so the euro sign and German quotes survive", async () => {
  const bytes = Buffer.concat([Buffer.from("code;label\n1;", "latin1"), Buffer.from([0x84, 0x47, 0x72, 0xf6, 0xdf, 0x65, 0x93, 0x20, 0x80])]);
  const { client } = clientFor(() => rawResponse(zipOf({ "t.csv": bytes }), "application/zip"));
  const result = await getFlatTable(client, { code: "12411-0001" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.rows[0], ["1", "\u201eGröße\u201c \u20ac"]);
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

test("getFlatTable unpacks only the file it reads: another entry of the archive is never inflated, however big it says it is", async () => {
  const archive = zipOf({ "junk.bin": "x".repeat(100), "12411-0001_flat.csv": FFCSV_12411_0001 });
  // The first central-directory entry (junk.bin) now declares 4 GiB unpacked, and its packed bytes are garbage.
  const centralOfJunk = archive.length - 22 - (46 + "junk.bin".length) - (46 + "12411-0001_flat.csv".length);
  archive.writeUInt32LE(0xf0000000, centralOfJunk + 24);
  archive.fill(0xff, 30 + "junk.bin".length, 30 + "junk.bin".length + 4);
  const { client } = clientFor(() => rawResponse(archive, "application/zip"));
  const result = await getFlatTable(client, { code: "12411-0001" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.file, "12411-0001_flat.csv");
  assert.equal(result.total, 2);
  // Listing reads names only; a file is unpacked (and checked against the cap) when read.
  const entries = zipEntries(archive);
  assert.deepEqual(entries.map((entry) => entry.name), ["junk.bin", "12411-0001_flat.csv"]);
  assert.throws(() => entries[0]?.read(), (err: unknown) => err instanceof DestatisParseError && /more than this client reads/.test(err.message));
  assert.match(entries[1]?.read().toString("utf8") ?? "", /^statistics_code;/);
});

test("getFlatTable: the flat CSV is the file read, an archive without a CSV is an error, and a header without rows is empty with a reason", async () => {
  const flatOf = async (archive: Buffer) => getFlatTable(clientFor(() => rawResponse(archive, "application/zip")).client, { code: "12411-0001", startYear: "2022" });
  await assert.rejects(flatOf(zipOf({ "readme.txt": "hello\n" })), (err: unknown) => err instanceof DestatisParseError && /no CSV file/.test(err.message) && /readme\.txt/.test(err.message));
  const two = await flatOf(zipOf({ "a.csv": "x;y\n1;2\n", "12411-0001_flat.csv": FFCSV_12411_0001 }));
  assert.equal(two.status, "ok");
  if (two.status !== "ok") return;
  assert.equal(two.file, "12411-0001_flat.csv");
  assert.equal(two.total, 2);
  const header = FFCSV_12411_0001.split("\n")[0] as string;
  const none = await flatOf(zipOf({ "12411-0001_flat.csv": `${header}\n` }));
  assert.equal(none.status, "empty");
  if (none.status !== "empty") return;
  assert.match(none.reason, /no rows/);
  assert.match(none.reason, /selection excluded every value/);
});

test("readZip: an entry larger than the cap, an encrypted entry and something that isn't a ZIP are parse errors", () => {
  assert.throws(() => readZip(zipOf({ "big.csv": "x".repeat(2000) }), 1000), (err: unknown) => err instanceof DestatisParseError && /more than this client reads/.test(err.message));
  const encrypted = zipOf({ "a.csv": "a" });
  encrypted.writeUInt16LE(0x801, encrypted.length - 22 - 46 - 5 + 8);
  assert.throws(() => readZip(encrypted), /encrypted/);
  assert.throws(() => readZip(Buffer.from("PK\u0003\u0004 not really")), DestatisParseError);
  assert.deepEqual(readZip(zipOf({ "dir/": "", "a.csv": "a;b" })).map((e) => e.name), ["a.csv"]);
});

test("an HTML 404 without a GENESIS status (a moved path, a proxy) is the client's error, never 'no such object'", async () => {
  const page = () => rawResponse("<!DOCTYPE html><html><body><h1>HTTP Status 404 – Not Found</h1></body></html>", "text/html", 404);
  const isBare404 = (err: unknown) => err instanceof DestatisApiError && err.httpStatus === 404 && err.code === undefined;
  await assert.rejects(fetchData(clientFor(page).client, { code: "12411-0001" }), isBare404);
  await assert.rejects(getFlatTable(clientFor(page).client, { code: "12411-0001" }), isBare404);
  await assert.rejects(describeObject(clientFor(page).client, { code: "12411-0001" }), isBare404);
  // The data answered "nothing" (104), but the metadata that tells why is not found itself.
  const { client } = clientFor((endpoint) => (endpoint.startsWith("metadata/") ? page() : jsonResponse(EMPTY_104("data", "table"))));
  await assert.rejects(fetchData(client, { code: "12411-0001" }), isBare404);
});

test("an answer without the keys every success has (a changed shape) is a parse error, never 'nothing found'", async () => {
  const drifted = (endpoint: string) => {
    if (endpoint === "find/find") return jsonResponse(genesis("find", "find", { Tabellen: [{ Code: "12411-0001", Content: "x" }] }));
    if (endpoint === "data/table") return jsonResponse(genesis("data", "table", { Object: { Code: "12411-0001", Inhalt: "a;b\n1;2\n" } }));
    if (endpoint === "metadata/table") return jsonResponse(genesis("metadata", "table", { Object: { Code: "12411-0001", Content: "x", Struktur: {} } }));
    if (endpoint === "catalogue/tables") return jsonResponse(genesis("catalogue", "tables", { Liste: [{ Code: "12411-0001", Content: "x" }] }));
    return jsonResponse(EMPTY_104("data", "table"));
  };
  const parseError = (key: string) => (err: unknown) => err instanceof DestatisParseError && err.message.includes(key);
  await assert.rejects(findStatistics(clientFor(drifted).client, { term: "Bevölkerung" }), parseError("Tables"));
  await assert.rejects(fetchData(clientFor(drifted).client, { code: "12411-0001" }), parseError("Content"));
  await assert.rejects(describeObject(clientFor(drifted).client, { code: "12411-0001" }), parseError("Structure"));
  await assert.rejects(browseCatalogue(clientFor(drifted).client, { selection: "12411*" }), parseError("List"));
  // The real empty shapes stay empty: every find list null, 104 without an Object or a List.
  assert.equal((await findStatistics(clientFor(() => jsonResponse(FIND_NONE)).client, { term: "x" })).status, "empty");
  assert.equal((await describeObject(clientFor(() => jsonResponse(EMPTY_104("metadata", "table"))).client, { code: "12411-0001" })).status, "empty");
  assert.equal((await browseCatalogue(clientFor(() => jsonResponse(EMPTY_104("catalogue", "tables"))).client, { selection: "9*" })).status, "empty");
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
