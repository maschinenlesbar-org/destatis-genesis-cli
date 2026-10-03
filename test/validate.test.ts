import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValid, type Problem } from "../src/client/validate.js";
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
