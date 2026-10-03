// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject and
// send nothing, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { DestatisValidationError } from "../src/client/errors.js";
import type { Transport } from "../src/client/http.js";
import { CRITERIA, DATA_FILE_FORMATS, FIND_CATEGORIES, LANGUAGES, MAX_PAGELENGTH } from "../src/client/params.js";
import { buildProgram } from "../src/cli/program.js";
import type { Command } from "commander";
import { jsonResponse, parity, requestKey, rawResponse, type ParityResult } from "./helpers.js";
import * as fx from "./fixtures.js";

const TOKEN_VALUE = "0123456789abcdef0123456789abcdef";
const TOKEN = ["--token", TOKEN_VALUE];

function client(transport: Transport, options: Omit<DestatisClientOptions, "transport"> = {}): DestatisClient {
  return new DestatisClient({ token: TOKEN_VALUE, ...options, transport });
}

/** Both sides reject the input and neither sends a request. */
function assertBothReject(p: ParityResult, libMessage?: RegExp): void {
  assert.equal(p.cli.code, 2, `CLI exit (stderr: ${p.cli.err})`);
  assert.equal(p.cli.requests.length, 0, "CLI sent a request");
  assert.equal(p.lib.ok, false, "library resolved");
  assert.equal(p.lib.requests.length, 0, "library sent a request");
  if (!p.lib.ok) {
    assert.ok(p.lib.error instanceof DestatisValidationError, `library threw ${String(p.lib.error)}`);
    if (libMessage) assert.match((p.lib.error as Error).message, libMessage);
  }
}

/** Both sides send the identical request. */
function assertSameRequest(p: ParityResult): void {
  assert.equal(p.cli.code, 0, `CLI exit (stderr: ${p.cli.err})`);
  assert.ok(p.lib.ok, `library rejected: ${p.lib.ok ? "" : String(p.lib.error)}`);
  assert.deepEqual(p.cli.requests.map(requestKey), p.lib.requests.map(requestKey));
  assert.equal(p.cli.requests.length, 1);
}

const ZIP = () => rawResponse(Buffer.from("PK\x03\x04zip"), "application/zip");

// ---- Finding 1 (PAT-9): blank ids, selections, search terms and filters ----------

const blankCases: Array<{ label: string; argv: string[]; lib: (c: DestatisClient) => Promise<unknown>; key: string; zip?: boolean }> = [
  {
    label: "data result --region-key ''",
    argv: [...TOKEN, "data", "result", "R1", "--region-key", ""],
    lib: (c) => c.data.result("R1", { regionalkey: "" }),
    key: "regionalkey",
  },
  {
    label: "find '  '",
    argv: ["find", "  "],
    lib: (c) => c.find({ term: "  " }),
    key: "term",
  },
  {
    label: "catalogue tables ' '",
    argv: [...TOKEN, "catalogue", "tables", " "],
    lib: (c) => c.catalogue.tables({ selection: " " }),
    key: "selection",
  },
  {
    label: "catalogue statistics 1* --area ''",
    argv: [...TOKEN, "catalogue", "statistics", "1*", "--area", ""],
    lib: (c) => c.catalogue.statistics({ selection: "1*", area: "" }),
    key: "area",
  },
  {
    label: "catalogue tables 124* --type ' '",
    argv: [...TOKEN, "catalogue", "tables", "124*", "--type", " "],
    lib: (c) => c.catalogue.tables({ selection: "124*", type: " " }),
    key: "type",
  },
  {
    label: "metadata table ''",
    argv: [...TOKEN, "metadata", "table", ""],
    lib: (c) => c.metadata.table(""),
    key: "name",
  },
  {
    label: "metadata table N --area ' '",
    argv: [...TOKEN, "metadata", "table", "N", "--area", " "],
    lib: (c) => c.metadata.table("N", { area: " " }),
    key: "area",
  },
  {
    label: "data table --class-var1 GES --class-key1 ' '",
    argv: [...TOKEN, "data", "table", "12411-0001", "--class-var1", "GES", "--class-key1", " "],
    lib: (c) => c.data.table("12411-0001", { classifyingvariable1: "GES", classifyingkey1: " " }),
    key: "classifyingkey1",
  },
  {
    label: "data table --start-year ' '",
    argv: [...TOKEN, "data", "table", "12411-0001", "--start-year", " "],
    lib: (c) => c.data.table("12411-0001", { startyear: " " }),
    key: "startyear",
  },
  {
    label: "data timeseries ''",
    argv: [...TOKEN, "data", "timeseries", ""],
    lib: (c) => c.data.timeseries(""),
    key: "name",
  },
  {
    label: "data cubefile N --class-key1 ' '",
    argv: [...TOKEN, "-o", "out.zip", "data", "cubefile", "N", "--class-key1", " "],
    lib: (c) => c.data.cubeFile("N", { classifyingkey1: " " }),
    key: "classifyingkey1",
    zip: true,
  },
  {
    label: "data resultfile ''",
    argv: [...TOKEN, "-o", "out.zip", "data", "resultfile", ""],
    lib: (c) => c.data.resultFile(""),
    key: "name",
    zip: true,
  },
];

for (const bc of blankCases) {
  test(`parity #1: ${bc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...bc.argv],
      lib: (t) => bc.lib(client(t)),
      responder: bc.zip ? ZIP : () => jsonResponse(fx.dataTable),
    });
    assertBothReject(p, new RegExp(`^Invalid ${bc.key}: Expected a non-empty value\\.$`));
  });
}

test("parity #1: a library method rejects a blank value instead of throwing synchronously", () => {
  const c = new DestatisClient({ token: TOKEN_VALUE, transport: async () => jsonResponse({}) });
  const pending = c.metadata.table("");
  assert.ok(pending instanceof Promise);
  return assert.rejects(pending, DestatisValidationError);
});

test("parity #1 control: a non-blank filter sends the identical request on both sides", async () => {
  const p = await parity({
    argv: ["--compact", ...TOKEN, "--language", "de", "data", "result", "R1", "--region-key", "05"],
    lib: (t) => client(t).data.result("R1", { language: "de", regionalkey: "05" }),
    responder: () => jsonResponse(fx.dataTable),
  });
  assertSameRequest(p);
});

// ---- Finding 7 (PAT-12): language, find category and the criteria are enums ------

const enumCases: Array<{ label: string; argv: string[]; lib: (c: DestatisClient) => Promise<unknown>; key: string }> = [
  {
    label: "--language fr find Bev",
    argv: ["--language", "fr", "find", "Bev"],
    lib: (c) => c.find({ term: "Bev", language: "fr" as never }),
    key: "language",
  },
  {
    label: "--language '' find Bev",
    argv: ["--language", "", "find", "Bev"],
    lib: (c) => c.find({ term: "Bev", language: "" as never }),
    key: "language",
  },
  {
    label: "--language EN logincheck",
    argv: [...TOKEN, "--language", "EN", "logincheck"],
    lib: (c) => c.logincheck("EN" as never),
    key: "language",
  },
  {
    label: "--language fr metadata table",
    argv: [...TOKEN, "--language", "fr", "metadata", "table", "12411-0001"],
    lib: (c) => c.metadata.table("12411-0001", { language: "fr" as never }),
    key: "language",
  },
  {
    label: "--language ' en' data table",
    argv: [...TOKEN, "--language", " en", "data", "table", "12411-0001"],
    lib: (c) => c.data.table("12411-0001", { language: " en" as never }),
    key: "language",
  },
  {
    label: "find Bev --category Tables",
    argv: ["find", "Bev", "--category", "Tables"],
    lib: (c) => c.find({ term: "Bev", category: "Tables" as never }),
    key: "category",
  },
  {
    label: "catalogue tables 124* --search-criterion code",
    argv: [...TOKEN, "catalogue", "tables", "124*", "--search-criterion", "code"],
    lib: (c) => c.catalogue.tables({ selection: "124*", searchcriterion: "code" as never }),
    key: "searchcriterion",
  },
  {
    label: "catalogue tables 124* --sort-criterion x",
    argv: [...TOKEN, "catalogue", "tables", "124*", "--sort-criterion", "x"],
    lib: (c) => c.catalogue.tables({ selection: "124*", sortcriterion: "x" as never }),
    key: "sortcriterion",
  },
];

for (const ec of enumCases) {
  test(`parity #7: ${ec.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...ec.argv],
      lib: (t) => ec.lib(client(t)),
      responder: () => jsonResponse(fx.findResult),
    });
    assertBothReject(p, new RegExp(`^Invalid ${ec.key}: Allowed choices are `));
  });
}

test("parity #7 control: --language en find Bev --category tables sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", "--language", "en", "find", "Bev", "--category", "tables"],
    lib: (t) => new DestatisClient({ transport: t }).find({ term: "Bev", language: "en", category: "tables" }),
    responder: () => jsonResponse(fx.findResult),
  });
  assertSameRequest(p);
});

test("parity #7: the CLI's choices are the library's exported value lists", () => {
  const program = buildProgram();
  const choices = (cmd: Command, flag: string) => cmd.options.find((o) => o.long === flag)?.argChoices;
  assert.deepEqual(choices(program, "--language"), [...LANGUAGES]);
  const find = program.commands.find((c) => c.name() === "find")!;
  assert.deepEqual(choices(find, "--category"), [...FIND_CATEGORIES]);
  const tables = program.commands.find((c) => c.name() === "catalogue")!.commands.find((c) => c.name() === "tables")!;
  assert.deepEqual(choices(tables, "--search-criterion"), [...CRITERIA]);
  assert.deepEqual(choices(tables, "--sort-criterion"), [...CRITERIA]);
});

// ---- Finding 8 (PAT-12): the data file --format list --------------------------------

const formatCases: Array<{ label: string; argv: string[]; lib: (c: DestatisClient) => Promise<unknown> }> = [
  {
    label: "data tablefile --format XLSX",
    argv: ["data", "tablefile", "12411-0001", "--format", "XLSX"],
    lib: (c) => c.data.tableFile("12411-0001", { format: "XLSX" as never }),
  },
  {
    label: "data cubefile --format pdf",
    argv: ["data", "cubefile", "12411BJ001", "--format", "pdf"],
    lib: (c) => c.data.cubeFile("12411BJ001", { format: "pdf" as never }),
  },
  {
    label: "data timeseriesfile --format zip",
    argv: ["data", "timeseriesfile", "N", "--format", "zip"],
    lib: (c) => c.data.timeseriesFile("N", { format: "zip" as never }),
  },
  {
    label: "data resultfile --format ''",
    argv: ["data", "resultfile", "N", "--format", ""],
    lib: (c) => c.data.resultFile("N", { format: "" as never }),
  },
  {
    label: "data tablefile --format ' csv'",
    argv: ["data", "tablefile", "12411-0001", "--format", " csv"],
    lib: (c) => c.data.tableFile("12411-0001", { format: " csv" as never }),
  },
];

for (const fc of formatCases) {
  test(`parity #8: ${fc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...TOKEN, "-o", "out.zip", ...fc.argv],
      lib: (t) => fc.lib(client(t)),
      responder: ZIP,
    });
    assertBothReject(p, /^Invalid format: Allowed choices are datencsv, csv, ffcsv, xlsx, html, genml\.$/);
  });
}

test("parity #8 control: data tablefile --format xlsx sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", ...TOKEN, "--language", "de", "-o", "out.zip", "data", "tablefile", "12411-0001", "--format", "xlsx"],
    lib: (t) => client(t).data.tableFile("12411-0001", { language: "de", format: "xlsx" }),
    responder: ZIP,
  });
  assertSameRequest(p);
});

test("parity #8: the CLI's --format choices are the library's DATA_FILE_FORMATS", () => {
  const data = buildProgram().commands.find((c) => c.name() === "data")!;
  for (const name of ["tablefile", "cubefile", "timeseriesfile", "resultfile"]) {
    const cmd = data.commands.find((c) => c.name() === name)!;
    assert.deepEqual(cmd.options.find((o) => o.long === "--format")?.argChoices, [...DATA_FILE_FORMATS]);
  }
});

// ---- Finding 9 (PAT-15): no CLI-only request defaults --------------------------------

const defaultCases: Array<{ label: string; argv: string[]; lib: (t: Transport) => Promise<unknown>; zip?: boolean }> = [
  { label: "find Bev", argv: ["find", "Bev"], lib: (t) => new DestatisClient({ transport: t }).find({ term: "Bev" }) },
  { label: "logincheck", argv: [...TOKEN, "logincheck"], lib: (t) => client(t).logincheck() },
  { label: "catalogue tables 124*", argv: [...TOKEN, "catalogue", "tables", "124*"], lib: (t) => client(t).catalogue.tables({ selection: "124*" }) },
  { label: "catalogue modified", argv: [...TOKEN, "catalogue", "modified"], lib: (t) => client(t).catalogue.modifiedData() },
  { label: "metadata table 12411-0001", argv: [...TOKEN, "metadata", "table", "12411-0001"], lib: (t) => client(t).metadata.table("12411-0001") },
  { label: "data table 12411-0001", argv: [...TOKEN, "data", "table", "12411-0001"], lib: (t) => client(t).data.table("12411-0001") },
  {
    label: "data cubefile 12411BJ001",
    argv: [...TOKEN, "-o", "out.zip", "data", "cubefile", "12411BJ001"],
    lib: (t) => client(t).data.cubeFile("12411BJ001"),
    zip: true,
  },
];

for (const dc of defaultCases) {
  test(`parity #9: ${dc.label} with no --language/--category sends the identical request`, async () => {
    const p = await parity({
      argv: ["--compact", ...dc.argv],
      lib: dc.lib,
      responder: dc.zip ? ZIP : () => jsonResponse(fx.findResult),
    });
    assertSameRequest(p);
    const body = new URLSearchParams(p.cli.requests[0]!.body?.toString() ?? "");
    assert.equal(body.has("language"), false);
    assert.equal(body.has("category"), false);
  });
}

test("parity #9: --help names the server defaults for --language and --category", async () => {
  const p = await parity({ argv: ["--help"], lib: async () => undefined });
  assert.match(p.cli.out, /--language <lang>\s+response language \(server default: de\)/);
  const f = await parity({ argv: ["find", "--help"], lib: async () => undefined });
  assert.match(f.cli.out, /server default: all/);
});

// ---- Finding 2 (PAT-11): pagelength 1..MAX_PAGELENGTH, timeslices >= 0 -------------

const boundCases: Array<{ label: string; argv: string[]; lib: (c: DestatisClient) => Promise<unknown>; msg: RegExp; zip?: boolean }> = [
  { label: "find --pagelength 0", argv: ["--pagelength", "0", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: 0 }), msg: /^Invalid pagelength: Must be >= 1\.$/ },
  { label: "find --pagelength -1", argv: ["--pagelength", "-1", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: -1 }), msg: /^Invalid pagelength: Expected a non-negative integer\.$/ },
  { label: "find --pagelength 1.5", argv: ["--pagelength", "1.5", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: 1.5 }), msg: /^Invalid pagelength: Expected a non-negative integer\.$/ },
  { label: "find --pagelength NaN", argv: ["--pagelength", "NaN", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: NaN }), msg: /^Invalid pagelength: Expected a non-negative integer\.$/ },
  { label: "find --pagelength 25001", argv: ["--pagelength", "25001", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: 25001 }), msg: /^Invalid pagelength: Must be <= 25000\.$/ },
  { label: "find --pagelength 1e20", argv: ["--pagelength", "99999999999999999999", "find", "Bev"], lib: (c) => c.find({ term: "Bev", pagelength: 1e20 }), msg: /^Invalid pagelength: Expected a non-negative integer\.$/ },
  { label: "catalogue values --pagelength 30000", argv: [...TOKEN, "--pagelength", "30000", "catalogue", "values", "1*"], lib: (c) => c.catalogue.values({ selection: "1*", pagelength: 30000 }), msg: /^Invalid pagelength: Must be <= 25000\.$/ },
  { label: "data table --timeslices -1", argv: [...TOKEN, "data", "table", "12411-0001", "--timeslices", "-1"], lib: (c) => c.data.table("12411-0001", { timeslices: -1 }), msg: /^Invalid timeslices: Expected a non-negative integer\.$/ },
  { label: "data table --timeslices 1.5", argv: [...TOKEN, "data", "table", "12411-0001", "--timeslices", "1.5"], lib: (c) => c.data.table("12411-0001", { timeslices: 1.5 }), msg: /^Invalid timeslices: Expected a non-negative integer\.$/ },
  { label: "data table --timeslices Infinity", argv: [...TOKEN, "data", "table", "12411-0001", "--timeslices", "Infinity"], lib: (c) => c.data.table("12411-0001", { timeslices: Infinity }), msg: /^Invalid timeslices: Expected a non-negative integer\.$/ },
  { label: "data timeseries --timeslices NaN", argv: [...TOKEN, "data", "timeseries", "N", "--timeslices", "NaN"], lib: (c) => c.data.timeseries("N", { timeslices: NaN }), msg: /^Invalid timeslices: Expected a non-negative integer\.$/ },
  { label: "data cubefile --timeslices -1", argv: [...TOKEN, "-o", "out.zip", "data", "cubefile", "N", "--timeslices", "-1"], lib: (c) => c.data.cubeFile("N", { timeslices: -1 }), msg: /^Invalid timeslices: Expected a non-negative integer\.$/, zip: true },
];

for (const bc of boundCases) {
  test(`parity #2: ${bc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...bc.argv],
      lib: (t) => bc.lib(client(t)),
      responder: bc.zip ? ZIP : () => jsonResponse(fx.findResult),
    });
    assertBothReject(p, bc.msg);
  });
}

test("parity #2 control: --pagelength 25000 and --timeslices 0 send the identical request", async () => {
  const p = await parity({
    argv: ["--compact", "--pagelength", "25000", "find", "Bev"],
    lib: (t) => new DestatisClient({ transport: t }).find({ term: "Bev", pagelength: MAX_PAGELENGTH }),
    responder: () => jsonResponse(fx.findResult),
  });
  assertSameRequest(p);
  const d = await parity({
    argv: ["--compact", ...TOKEN, "data", "table", "12411-0001", "--timeslices", "0"],
    lib: (t) => client(t).data.table("12411-0001", { timeslices: 0 }),
    responder: () => jsonResponse(fx.dataTable),
  });
  assertSameRequest(d);
});

// ---- Finding 4 (PAT-5/PAT-6): header values for credentials and the User-Agent --------

const headerCases: Array<{
  label: string;
  argv: string[];
  env?: Record<string, string>;
  lib: (t: Transport) => Promise<unknown>;
  msg: RegExp;
}> = [
  {
    label: "--token ' tok ' find Bev",
    argv: ["--token", " tok ", "find", "Bev"],
    lib: (t) => new DestatisClient({ transport: t, token: " tok " }).find({ term: "Bev" }),
    msg: /^Invalid token: Value has leading or trailing whitespace, which an HTTP header cannot carry\.$/,
  },
  {
    label: "DESTATIS_API_TOKEN with CR/LF, find Bev",
    argv: ["find", "Bev"],
    env: { DESTATIS_API_TOKEN: "test\r\nX: y" },
    lib: (t) => new DestatisClient({ transport: t, token: "test\r\nX: y" }).find({ term: "Bev" }),
    msg: /^Invalid token: Value contains control characters\.$/,
  },
  {
    label: "--token 't€' find Bev",
    argv: ["--token", "t€", "find", "Bev"],
    lib: (t) => new DestatisClient({ transport: t, token: "t€" }).find({ term: "Bev" }),
    msg: /^Invalid token: Value contains characters outside Latin-1 \(above U\+00FF\)\.$/,
  },
  {
    label: "--username user --password ' pass ' logincheck",
    argv: ["--username", "user", "--password", " pass ", "logincheck"],
    lib: (t) => new DestatisClient({ transport: t, username: "user", password: " pass " }).logincheck(),
    msg: /^Invalid password: Value has leading or trailing whitespace/,
  },
  {
    label: "--username 'u\\x00' --password pass logincheck",
    argv: ["--username", "u\x00", "--password", "pass", "logincheck"],
    lib: (t) => new DestatisClient({ transport: t, username: "u\x00", password: "pass" }).logincheck(),
    msg: /^Invalid username: Value contains control characters\.$/,
  },
  {
    label: "--user-agent '' hello",
    argv: ["--user-agent", "", "hello"],
    lib: (t) => new DestatisClient({ transport: t, userAgent: "" }).whoami(),
    msg: /^Invalid userAgent: Expected a non-empty value\.$/,
  },
  {
    label: "--user-agent with CR/LF, hello",
    argv: ["--user-agent", "a\r\nX-Evil: 1", "hello"],
    lib: (t) => new DestatisClient({ transport: t, userAgent: "a\r\nX-Evil: 1" }).whoami(),
    msg: /^Invalid userAgent: Value contains control characters\.$/,
  },
  {
    label: "--user-agent with DEL, hello",
    argv: ["--user-agent", "a\x7fb", "hello"],
    lib: (t) => new DestatisClient({ transport: t, userAgent: "a\x7fb" }).whoami(),
    msg: /^Invalid userAgent: Value contains control characters\.$/,
  },
  {
    label: "--user-agent '€' hello",
    argv: ["--user-agent", "€", "hello"],
    lib: (t) => new DestatisClient({ transport: t, userAgent: "€" }).whoami(),
    msg: /^Invalid userAgent: Value contains characters outside Latin-1/,
  },
];

for (const hc of headerCases) {
  test(`parity #4: ${hc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...hc.argv],
      ...(hc.env ? { env: hc.env } : {}),
      lib: hc.lib,
      responder: () => jsonResponse(fx.findResult),
    });
    assertBothReject(p, hc.msg);
  });
}

for (const ua of ["é", "a\tb", " ua "]) {
  test(`parity #4 control: --user-agent ${JSON.stringify(ua)} is sent by both`, async () => {
    const p = await parity({
      argv: ["--compact", "--user-agent", ua, "hello"],
      lib: (t) => new DestatisClient({ transport: t, userAgent: ua }).whoami(),
      responder: () => jsonResponse(fx.whoami),
    });
    assert.equal(p.cli.code, 0, p.cli.err);
    assert.ok(p.lib.ok);
    assert.equal(p.cli.requests[0]!.headers?.["User-Agent"], ua);
    assert.equal(p.lib.requests[0]!.headers?.["User-Agent"], ua);
  });
}

test("parity #4: the library still treats a blank credential as unset (the env path does too)", async () => {
  const p = await parity({
    argv: ["--compact", "find", "Bev"],
    env: { DESTATIS_API_TOKEN: "   " },
    lib: (t) => new DestatisClient({ transport: t, token: "   " }).find({ term: "Bev" }),
    responder: () => jsonResponse(fx.findResult),
  });
  assertSameRequest(p);
});

// ---- Finding 5 (PAT-1): base URL userinfo and whitespace -----------------------------

const baseUrlCases: Array<{ url: string; msg: RegExp }> = [
  { url: "https://u:p@h.example", msg: /^Invalid baseUrl: Must not embed credentials \(user:pass@host\)\.$/ },
  { url: "https://u@h.example", msg: /^Invalid baseUrl: Must not embed credentials/ },
  { url: "https://h.example/ ", msg: /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/ },
  { url: " https://h.example ", msg: /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/ },
  { url: "https://h.example\t", msg: /^Invalid baseUrl: A base URL cannot have surrounding whitespace\.$/ },
  { url: "https://h.example/p\tx", msg: /^Invalid baseUrl: A base URL cannot contain whitespace or control characters\.$/ },
  { url: "https://h.example/p\nx", msg: /^Invalid baseUrl: A base URL cannot contain whitespace or control characters\.$/ },
  { url: " https://u:p@h.example", msg: /^Invalid baseUrl: Must not embed credentials/ },
];

for (const bc of baseUrlCases) {
  test(`parity #5: base URL ${JSON.stringify(bc.url)} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", "--base-url", bc.url, "hello"],
      lib: (t) => new DestatisClient({ transport: t, baseUrl: bc.url }).whoami(),
      responder: () => jsonResponse(fx.whoami),
    });
    assertBothReject(p, bc.msg);
    if (!p.lib.ok) assert.doesNotMatch((p.lib.error as Error).message, /u:p|h\.example/);
  });
}

test("parity #5: the CLI keeps its flag hint for an embedded credential", async () => {
  const p = await parity({
    argv: ["--compact", "--base-url", "https://u:p@h.example", "hello"],
    lib: async () => undefined,
  });
  assert.match(p.cli.err, /Must not embed credentials \(user:pass@host\)\. Use --token or --username\/--password\./);
});

test("parity #5 control: a base URL with a path prefix sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", "--base-url", "https://h.example/prefix/", "hello"],
    lib: (t) => new DestatisClient({ transport: t, baseUrl: "https://h.example/prefix/" }).whoami(),
    responder: () => jsonResponse(fx.whoami),
  });
  assert.equal(p.cli.code, 0, p.cli.err);
  assert.ok(p.lib.ok);
  assert.equal(p.cli.requests[0]!.url, "https://h.example/prefix/genesisWS/rest/2020/helloworld/whoami");
  assert.equal(p.lib.requests[0]!.url, p.cli.requests[0]!.url);
});
