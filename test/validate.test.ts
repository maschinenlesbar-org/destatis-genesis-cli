import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRequestParams, assertValid, intRangeProblem, nonBlankProblem, oneOfProblem, type Problem } from "../src/client/validate.js";
import {
  DestatisError,
  DestatisUsageError,
  DestatisValidationError,
} from "../src/client/errors.js";
import * as lib from "../src/index.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { DestatisClient } from "../src/client/client.js";
import { jsonResponse, parity } from "./helpers.js";
import * as fx from "./fixtures.js";

const evenProblem: Problem<number> = (n) => (n % 2 === 0 ? undefined : "Expected an even number.");

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("count", 4, evenProblem), 4);
});

test("assertValid throws DestatisValidationError with 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("count", 3, evenProblem),
    (err: unknown) => {
      assert.ok(err instanceof DestatisValidationError);
      assert.equal((err as Error).message, "Invalid count: Expected an even number.");
      return true;
    },
  );
});

test("DestatisValidationError extends DestatisUsageError and DestatisError", () => {
  const err = new DestatisValidationError("Invalid x: y");
  assert.ok(err instanceof DestatisUsageError);
  assert.ok(err instanceof DestatisError);
  assert.equal(err.name, "DestatisValidationError");
});

test("the package root exports the validation layer", () => {
  assert.equal(lib.DestatisValidationError, DestatisValidationError);
  assert.equal(lib.assertValid, assertValid);
});

function depsThrowing(err: unknown): { deps: CliDeps; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => errs.push(s),
      writeFile: () => undefined,
      fileExists: () => false,
      outBinary: () => undefined,
    },
    createClient: () => {
      throw err;
    },
    env: {},
  };
  return { deps, out, errs };
}

test("run maps a DestatisValidationError raised during an action to exit 2 with 'Error: <message>'", async () => {
  const { deps, errs } = depsThrowing(new DestatisValidationError("Invalid thing: Expected a non-empty value."));
  const code = await run(["hello"], deps);
  assert.equal(code, 2);
  assert.deepEqual(errs, ["Error: Invalid thing: Expected a non-empty value."]);
});

test("parity() runs the CLI and the library on one recording transport", async () => {
  const p = await parity({
    argv: ["--compact", "hello"],
    lib: (transport) => new DestatisClient({ transport }).whoami(),
    responder: () => jsonResponse(fx.whoami),
  });
  assert.equal(p.cli.code, 0);
  assert.equal(p.cli.requests.length, 1);
  assert.ok(p.lib.ok);
  assert.equal(p.lib.requests.length, 1);
  assert.equal(p.cli.requests[0]!.url, p.lib.requests[0]!.url);
});

test("nonBlankProblem accepts text and rejects blank or non-string values", () => {
  assert.equal(nonBlankProblem("124*"), undefined);
  assert.equal(nonBlankProblem(" x "), undefined);
  for (const v of ["", " ", "\t\n", undefined, null, 5]) {
    assert.equal(nonBlankProblem(v), "Expected a non-empty value.", JSON.stringify(v));
  }
});

test("assertRequestParams rejects a blank string, naming the parameter, and skips omitted ones", () => {
  assert.doesNotThrow(() => assertRequestParams({ a: "x", b: undefined, c: null, d: 3, e: true }));
  assert.throws(
    () => assertRequestParams({ selection: "1*", regionalkey: " " }),
    (err: unknown) =>
      err instanceof DestatisValidationError && err.message === "Invalid regionalkey: Expected a non-empty value.",
  );
});

test("oneOfProblem accepts only the listed values, case-sensitively", () => {
  const problem = oneOfProblem(["de", "en"] as const);
  assert.equal(problem("de"), undefined);
  assert.equal(problem("en"), undefined);
  for (const v of ["fr", "EN", "", " en", undefined, 1]) {
    assert.equal(problem(v), "Allowed choices are de, en.", JSON.stringify(v));
  }
});

test("assertRequestParams checks the enumerated GENESIS parameters against their lists", () => {
  assert.doesNotThrow(() =>
    assertRequestParams({ language: "en", category: "time-series", searchcriterion: "Code", sortcriterion: "Content" }),
  );
  assert.throws(
    () => assertRequestParams({ language: "fr" }),
    (err: unknown) => err instanceof DestatisValidationError && err.message === "Invalid language: Allowed choices are de, en.",
  );
  assert.throws(() => assertRequestParams({ category: "Tables" }), DestatisValidationError);
  assert.throws(() => assertRequestParams({ searchcriterion: "code" }), DestatisValidationError);
  assert.throws(() => assertRequestParams({ sortcriterion: "" }), /Invalid sortcriterion: Allowed choices are Code, Content\./);
});

test("intRangeProblem accepts safe integers in range and words its reasons like the CLI", () => {
  const problem = intRangeProblem(1, 25000);
  assert.equal(problem(1), undefined);
  assert.equal(problem(25000), undefined);
  assert.equal(problem(0), "Must be >= 1.");
  assert.equal(problem(25001), "Must be <= 25000.");
  for (const v of [-1, 1.5, NaN, Infinity, 1e20, "10", undefined]) {
    assert.equal(problem(v), "Expected a non-negative integer.", String(v));
  }
});

test("assertRequestParams checks pagelength and timeslices", () => {
  assert.doesNotThrow(() => assertRequestParams({ pagelength: 25000, timeslices: 0 }));
  assert.throws(() => assertRequestParams({ pagelength: 0 }), /^DestatisValidationError: Invalid pagelength: Must be >= 1\.$/);
  assert.throws(() => assertRequestParams({ timeslices: -1 }), /Invalid timeslices: Expected a non-negative integer\./);
});
