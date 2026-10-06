// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject and
// send nothing, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { DestatisNetworkError, DestatisValidationError } from "../src/client/errors.js";
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
    argv: ["--compact", "--guest", "--language", "en", "find", "Bev", "--category", "tables"],
    lib: (t) => new DestatisClient({ guest: true, transport: t }).find({ term: "Bev", language: "en", category: "tables" }),
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
  { label: "find Bev", argv: ["--guest", "find", "Bev"], lib: (t) => new DestatisClient({ guest: true, transport: t }).find({ term: "Bev" }) },
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
      responder: dc.zip ? ZIP : (req) => jsonResponse(req.url.endsWith("/logincheck") ? fx.loginOk : fx.findResult),
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
    argv: ["--compact", "--guest", "--pagelength", "25000", "find", "Bev"],
    lib: (t) => new DestatisClient({ guest: true, transport: t }).find({ term: "Bev", pagelength: MAX_PAGELENGTH }),
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
    lib: (t) => new DestatisClient({ guest: true, transport: t, userAgent: "" }).whoami(),
    msg: /^Invalid userAgent: Expected a non-empty value\.$/,
  },
  {
    label: "--user-agent with CR/LF, hello",
    argv: ["--user-agent", "a\r\nX-Evil: 1", "hello"],
    lib: (t) => new DestatisClient({ guest: true, transport: t, userAgent: "a\r\nX-Evil: 1" }).whoami(),
    msg: /^Invalid userAgent: Value contains control characters\.$/,
  },
  {
    label: "--user-agent with DEL, hello",
    argv: ["--user-agent", "a\x7fb", "hello"],
    lib: (t) => new DestatisClient({ guest: true, transport: t, userAgent: "a\x7fb" }).whoami(),
    msg: /^Invalid userAgent: Value contains control characters\.$/,
  },
  {
    label: "--user-agent '€' hello",
    argv: ["--user-agent", "€", "hello"],
    lib: (t) => new DestatisClient({ guest: true, transport: t, userAgent: "€" }).whoami(),
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
      lib: (t) => new DestatisClient({ guest: true, transport: t, userAgent: ua }).whoami(),
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
    argv: ["--compact", "--guest", "find", "Bev"],
    env: { DESTATIS_API_TOKEN: "   " },
    lib: (t) => new DestatisClient({ guest: true, transport: t, token: "   " }).find({ term: "Bev" }),
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
      lib: (t) => new DestatisClient({ guest: true, transport: t, baseUrl: bc.url }).whoami(),
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
    lib: (t) => new DestatisClient({ guest: true, transport: t, baseUrl: "https://h.example/prefix/" }).whoami(),
    responder: () => jsonResponse(fx.whoami),
  });
  assert.equal(p.cli.code, 0, p.cli.err);
  assert.ok(p.lib.ok);
  assert.equal(p.cli.requests[0]!.url, "https://h.example/prefix/genesisWS/rest/2020/helloworld/whoami");
  assert.equal(p.lib.requests[0]!.url, p.cli.requests[0]!.url);
});

// ---- Finding 3 (PAT-7): username and password come as a pair --------------------------

const PAIR_CLI = /^Error: Provide BOTH --username and --password \(or use --token\)\. Env: DESTATIS_USERNAME \+ DESTATIS_PASSWORD, or DESTATIS_API_TOKEN\.$/m;
const PAIR_LIB = /^Invalid credentials: Provide both username and password \(or a token\)\.$/;

const pairCases: Array<{ label: string; argv: string[]; env?: Record<string, string>; lib: (t: Transport) => Promise<unknown> }> = [
  {
    label: "--username user find Bev",
    argv: ["--username", "user", "find", "Bev"],
    lib: (t) => new DestatisClient({ transport: t, username: "user" }).find({ term: "Bev" }),
  },
  {
    label: "--password pass find Bev",
    argv: ["--password", "pass", "find", "Bev"],
    lib: (t) => new DestatisClient({ transport: t, password: "pass" }).find({ term: "Bev" }),
  },
  {
    label: "DESTATIS_USERNAME=user logincheck",
    argv: ["logincheck"],
    env: { DESTATIS_USERNAME: "user" },
    lib: (t) => new DestatisClient({ transport: t, username: "user" }).logincheck(),
  },
  {
    label: "DESTATIS_PASSWORD=pass logincheck",
    argv: ["logincheck"],
    env: { DESTATIS_PASSWORD: "pass" },
    lib: (t) => new DestatisClient({ transport: t, password: "pass" }).logincheck(),
  },
  {
    label: "--username user with a blank DESTATIS_PASSWORD, metadata table",
    argv: ["--username", "user", "metadata", "table", "12411-0001"],
    env: { DESTATIS_PASSWORD: "" },
    lib: (t) => new DestatisClient({ transport: t, username: "user", password: "" }).metadata.table("12411-0001"),
  },
];

for (const pc of pairCases) {
  test(`parity #3: ${pc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...pc.argv],
      ...(pc.env ? { env: pc.env } : {}),
      lib: pc.lib,
      responder: () => jsonResponse(fx.findResult),
    });
    assertBothReject(p, PAIR_LIB);
    assert.match(p.cli.err, PAIR_CLI);
  });
}

test("parity #3: a lone username or password next to a token is not an error (the token wins)", async () => {
  const p = await parity({
    argv: ["--compact", "--token", TOKEN_VALUE, "find", "Bev"],
    env: { DESTATIS_USERNAME: "user" },
    lib: (t) => new DestatisClient({ transport: t, token: TOKEN_VALUE, username: "user" }).find({ term: "Bev" }),
    responder: () => jsonResponse(fx.findResult),
  });
  assertSameRequest(p);
  assert.equal(p.lib.requests[0]!.headers?.["username"], TOKEN_VALUE);
});

test("parity #3 control: a username/password pair sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", "logincheck"],
    env: { DESTATIS_USERNAME: "user", DESTATIS_PASSWORD: "pass" },
    lib: (t) => new DestatisClient({ transport: t, username: "user", password: "pass" }).logincheck(),
    responder: () => jsonResponse(fx.loginOk),
  });
  assertSameRequest(p);
});

// ---- Finding 6 (PAT-7): account-only endpoints need credentials ------------------------

const NO_CREDS_CLI =
  /^Error: No credentials\. Set --token \(env DESTATIS_API_TOKEN\) or --username\/--password \(env DESTATIS_USERNAME \/ DESTATIS_PASSWORD\), or pass --guest to run without an account \(guest access covers `find` only\)\. A free account is available at https:\/\/www-genesis\.destatis\.de\.$/m;
const NO_CREDS_LIB =
  /^Invalid credentials: No credentials: pass a token, a username and password, or guest: true for guest access \(whoami and find only\)\.$/;
const NEEDS_CLI = /^Error: `[a-z ]+` needs an account; --guest covers `find` only\. Set --token \(env DESTATIS_API_TOKEN\) or --username\/--password/m;
const NEEDS_LIB = /^Invalid credentials: This endpoint needs an account \(a token, or a username and password\)\.$/;

const needsCases: Array<{ label: string; argv: string[]; env?: Record<string, string>; lib: (t: Transport) => Promise<unknown> }> = [
  { label: "logincheck", argv: ["logincheck"], lib: (t) => new DestatisClient({ transport: t }).logincheck() },
  { label: "catalogue jobs", argv: ["catalogue", "jobs"], lib: (t) => new DestatisClient({ transport: t }).catalogue.jobs() },
  {
    label: "metadata table 12411-0001",
    argv: ["metadata", "table", "12411-0001"],
    lib: (t) => new DestatisClient({ transport: t }).metadata.table("12411-0001"),
  },
  {
    label: "data table 12411-0001",
    argv: ["data", "table", "12411-0001"],
    lib: (t) => new DestatisClient({ transport: t }).data.table("12411-0001"),
  },
  {
    label: "data cubefile 12411BJ001",
    argv: ["data", "cubefile", "12411BJ001"],
    lib: (t) => new DestatisClient({ transport: t }).data.cubeFile("12411BJ001"),
  },
  {
    label: "DESTATIS_API_TOKEN='  ' catalogue tables",
    argv: ["catalogue", "tables"],
    env: { DESTATIS_API_TOKEN: "  " },
    lib: (t) => new DestatisClient({ transport: t, token: "  " }).catalogue.tables(),
  },
];

for (const nc of needsCases) {
  test(`parity #6: ${nc.label} without credentials is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...nc.argv],
      ...(nc.env ? { env: nc.env } : {}),
      lib: nc.lib,
      responder: () => jsonResponse(fx.tablesList),
    });
    assertBothReject(p, NO_CREDS_LIB);
    assert.match(p.cli.err, NO_CREDS_CLI);
  });
}

// --guest (the library's guest: true) does not open the account-only endpoints.
const guestCases: Array<{ label: string; argv: string[]; lib: (c: DestatisClient) => Promise<unknown> }> = [
  { label: "logincheck", argv: ["logincheck"], lib: (c) => c.logincheck() },
  { label: "catalogue jobs", argv: ["catalogue", "jobs"], lib: (c) => c.catalogue.jobs() },
  { label: "metadata table 12411-0001", argv: ["metadata", "table", "12411-0001"], lib: (c) => c.metadata.table("12411-0001") },
  { label: "data table 12411-0001", argv: ["data", "table", "12411-0001"], lib: (c) => c.data.table("12411-0001") },
  { label: "data cubefile 12411BJ001", argv: ["data", "cubefile", "12411BJ001"], lib: (c) => c.data.cubeFile("12411BJ001") },
];

for (const gc of guestCases) {
  test(`parity #6: --guest ${gc.label} is rejected by both, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", "--guest", ...gc.argv],
      lib: (t) => gc.lib(new DestatisClient({ guest: true, transport: t })),
      responder: () => jsonResponse(fx.tablesList),
    });
    assertBothReject(p, NEEDS_LIB);
    assert.match(p.cli.err, NEEDS_CLI);
  });
}

test("parity #6: --guest with a credential is rejected by both, with no request", async () => {
  for (const [argv, env, lib] of [
    [["--guest", "--token", TOKEN_VALUE, "find", "Bev"], {}, { token: TOKEN_VALUE }],
    [["--guest", "find", "Bev"], { DESTATIS_API_TOKEN: TOKEN_VALUE }, { token: TOKEN_VALUE }],
    [["--guest", "find", "Bev"], { DESTATIS_USERNAME: "user", DESTATIS_PASSWORD: "pass" }, { username: "user", password: "pass" }],
    [["--guest", "--username", "user", "hello"], {}, { username: "user" }],
  ] as const) {
    const p = await parity({
      argv: ["--compact", ...argv],
      env: { ...env },
      lib: (t) => new DestatisClient({ ...lib, guest: true, transport: t }).find({ term: "Bev" }),
    });
    assertBothReject(p, /^Invalid credentials: guest: true cannot be combined with a token, username or password\.$/);
    assert.match(p.cli.err, /^Error: --guest cannot be combined with credentials \((--token|--username|DESTATIS_API_TOKEN|DESTATIS_USERNAME, DESTATIS_PASSWORD) set\)/m);
    assert.doesNotMatch(p.cli.err, /0123456789abcdef|pass\b/);
  }
});

test("parity #6 (and #11 part 3): --token '' catalogue tables is rejected by both, with no request", async () => {
  const p = await parity({
    argv: ["--compact", "--token", "", "catalogue", "tables"],
    lib: (t) => new DestatisClient({ transport: t, token: "" }).catalogue.tables(),
  });
  assertBothReject(p, NO_CREDS_LIB);
});

test("parity #6: a library method rejects instead of throwing synchronously", () => {
  const c = new DestatisClient({ guest: true, transport: async () => jsonResponse({}) });
  let promise: Promise<unknown> | undefined;
  assert.doesNotThrow(() => {
    promise = c.catalogue.tables();
  });
  return assert.rejects(promise!, DestatisValidationError);
});

for (const [label, argv, lib] of [
  ["hello", ["hello"], (t: Transport) => new DestatisClient({ guest: true, transport: t }).whoami()],
  ["--guest hello", ["--guest", "hello"], (t: Transport) => new DestatisClient({ guest: true, transport: t }).whoami()],
  ["--guest find Bev", ["--guest", "find", "Bev"], (t: Transport) => new DestatisClient({ guest: true, transport: t }).find({ term: "Bev" })],
] as const) {
  test(`parity #6 control: ${label} works without credentials on both sides`, async () => {
    const p = await parity({
      argv: ["--compact", ...argv],
      lib,
      responder: (req) => jsonResponse(req.url.endsWith("/whoami") ? fx.whoami : fx.findResult),
    });
    assert.equal(p.cli.code, 0, p.cli.err);
    assert.ok(p.lib.ok);
    assert.deepEqual(p.cli.requests.map(requestKey), p.lib.requests.map(requestKey));
    assert.equal(p.lib.requests.length, 1);
  });
}

test("parity #6 control: catalogue jobs with a token sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", ...TOKEN, "catalogue", "jobs"],
    lib: (t) => client(t).catalogue.jobs(),
    responder: () => jsonResponse(fx.tablesList),
  });
  assertSameRequest(p);
});

// ---- Finding 10 (PAT-2/PAT-8/PAT-23): base URL and numeric engine options --------------

const configCases: Array<{ label: string; argv: string[]; opts: Omit<DestatisClientOptions, "transport">; msg: RegExp; reason?: string }> = [
  { label: "--base-url ftp://h.example", argv: ["--base-url", "ftp://h.example"], opts: { baseUrl: "ftp://h.example" },
    msg: /^Invalid baseUrl: Only "http:" and "https:" URLs are allowed\.$/, reason: 'Only "http:" and "https:" URLs are allowed.' },
  { label: "--base-url https://h.example/?q=1", argv: ["--base-url", "https://h.example/?q=1"], opts: { baseUrl: "https://h.example/?q=1" },
    msg: /^Invalid baseUrl: A base URL cannot have a query \(\?\) or fragment \(#\)\.$/, reason: "A base URL cannot have a query (?) or fragment (#)." },
  { label: "--base-url https://h.example/#f", argv: ["--base-url", "https://h.example/#f"], opts: { baseUrl: "https://h.example/#f" },
    msg: /^Invalid baseUrl: A base URL cannot have a query/ },
  { label: "--base-url ''", argv: ["--base-url", ""], opts: { baseUrl: "" },
    msg: /^Invalid baseUrl: Must be an absolute http\(s\) URL\.$/, reason: "Must be an absolute http(s) URL." },
  { label: "--base-url 'not a url'", argv: ["--base-url", "not a url"], opts: { baseUrl: "not a url" },
    msg: /^Invalid baseUrl: Must be an absolute http\(s\) URL\.$/ },
  { label: "--timeout -1", argv: ["--timeout", "-1"], opts: { timeoutMs: -1 },
    msg: /^Invalid timeoutMs: Expected a non-negative integer\.$/, reason: "Expected a non-negative integer." },
  { label: "--timeout 2147483648", argv: ["--timeout", "2147483648"], opts: { timeoutMs: 2_147_483_648 },
    msg: /^Invalid timeoutMs: Must be <= 2147483647\.$/, reason: "Must be <= 2147483647." },
  { label: "--max-retries 11", argv: ["--max-retries", "11"], opts: { maxRetries: 11 },
    msg: /^Invalid maxRetries: Must be <= 10\.$/, reason: "Must be <= 10." },
  { label: "--max-response-bytes -1", argv: ["--max-response-bytes", "-1"], opts: { maxResponseBytes: -1 },
    msg: /^Invalid maxResponseBytes: Expected a non-negative integer\.$/ },
];

for (const cc of configCases) {
  test(`parity #10: ${cc.label} is a validation error on both sides, with no request`, async () => {
    const p = await parity({
      argv: ["--compact", ...cc.argv, "hello"],
      lib: (t) => new DestatisClient({ ...cc.opts, guest: true, transport: t }).whoami(),
      responder: () => jsonResponse(fx.whoami),
    });
    assertBothReject(p, cc.msg);
    if (!p.lib.ok) assert.ok(!(p.lib.error instanceof DestatisNetworkError), "a config error is not a network error");
    if (cc.reason !== undefined) assert.ok(p.cli.err.includes(cc.reason), `CLI reason: ${p.cli.err}`);
  });
}

test("parity #10: a bad base URL message never echoes embedded userinfo", async () => {
  const p = await parity({
    argv: ["--compact", "--base-url", "ftp://SECRETUSER:HUNTER2@h.example", "hello"],
    lib: (t) => new DestatisClient({ guest: true, baseUrl: "ftp://SECRETUSER:HUNTER2@h.example", transport: t }).whoami(),
  });
  assertBothReject(p);
  assert.doesNotMatch(String(p.lib.ok ? "" : (p.lib.error as Error).message), /SECRETUSER|HUNTER2/);
});

test("parity #10 control: --timeout 0 --max-retries 10 --max-response-bytes 0 sends the identical request", async () => {
  const p = await parity({
    argv: ["--compact", "--guest", "--timeout", "0", "--max-retries", "10", "--max-response-bytes", "0", "find", "Bev"],
    lib: (t) => new DestatisClient({ guest: true, timeoutMs: 0, maxRetries: 10, maxResponseBytes: 0, transport: t }).find({ term: "Bev" }),
    responder: () => jsonResponse(fx.findResult),
  });
  assertSameRequest(p);
});
