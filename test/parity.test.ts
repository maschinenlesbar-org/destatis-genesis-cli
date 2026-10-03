// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome — both reject and
// send nothing, or both send the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DestatisClient, type DestatisClientOptions } from "../src/client/client.js";
import { DestatisValidationError } from "../src/client/errors.js";
import type { Transport } from "../src/client/http.js";
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
