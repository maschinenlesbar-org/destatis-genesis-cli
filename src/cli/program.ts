// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { DestatisClient } from "../client/client.js";
import { MAX_TIMEOUT_MS } from "../client/http.js";
import { MAX_RETRIES } from "../client/engine.js";
import { LANGUAGES, MAX_PAGELENGTH } from "../client/params.js";
import {
  CREDENTIAL_ENV_VARS,
  parseIntArg,
  parseBoundedInt,
  parseHeaderValue,
  parseSecret,
  parseNonEmpty,
  parseBaseUrl,
} from "./shared.js";
import { registerHelloCommands } from "./commands/hello.js";
import { registerFindCommand } from "./commands/find.js";
import { registerCatalogueCommands } from "./commands/catalogue.js";
import { registerMetadataCommands } from "./commands/metadata.js";
import { registerDataCommands } from "./commands/data.js";
import { registerConfigCommands } from "./commands/config.js";
import { CredentialStore } from "./credentials.js";
import { DEFAULT_LOG_FORMAT, logFormatProblem } from "./log.js";

/**
 * Single source of truth for the version: read from package.json at runtime
 * rather than duplicating a literal that can silently drift after a release bump.
 * From the compiled location (dist/src/cli/program.js) package.json is three
 * directories up; the same offset holds for the source under src/cli.
 */
function readVersion(): string {
  try {
    const pkgUrl = new URL("../../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/**
 * Default dependencies: real client + real stdout/stderr/filesystem + real env, and
 * the user's credentials file (`destatis config`). Only these set `credentials`: deps
 * built elsewhere — every test that does not ask for it — never read one.
 */
export const defaultDeps: CliDeps = {
  io: defaultIO,
  createClient: (options) => new DestatisClient(options),
  env: process.env,
  credentials: () => CredentialStore.fromEnv(process.env),
};

/**
 * Read a credential env var. A missing, empty, or whitespace-only value is treated
 * as unset (returns undefined) so it never seeds a blank credential; any other value
 * is used exactly as set (never trimmed into a different credential).
 *
 * The value is NOT validated here: help, `--version` and `hello` must work whatever
 * the variable holds, and a flag may override it. `action()` checks the values a
 * command actually uses (`checkEnvCredentials` in shared.ts).
 */
function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  if (raw.trim().length === 0) return undefined;
  return raw;
}

/** commander value-parser for `--log-format`. */
function parseLogFormat(value: string): string {
  const problem = logFormatProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
}

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();

  program
    .name("destatis")
    .description(
      "CLI for the DESTATIS GENESIS-Online REST API " +
        "(https://genesis.destatis.de) — Germany's official-statistics database. " +
        "Needs a free account: pass --token (env DESTATIS_API_TOKEN) or " +
        "--username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD), or store them once " +
        "with `destatis config set token` (or `username` and `password`). " +
        "Register at https://www-genesis.destatis.de. Without an account, pass --guest " +
        "explicitly: `destatis --guest find …` searches as the GENESIS guest user; " +
        "`destatis hello` needs neither.",
    )
    .version(VERSION)
    .option("--base-url <url>", "API base URL", parseBaseUrl, "https://genesis.destatis.de")
    .option("--token <token>", "GENESIS API token (env: DESTATIS_API_TOKEN)", parseSecret("--token <token>"))
    .option("--username <user>", "GENESIS account username (env: DESTATIS_USERNAME)", parseSecret("--username <user>"))
    .option("--password <pass>", "GENESIS account password (env: DESTATIS_PASSWORD)", parseSecret("--password <pass>"))
    .option(
      "--guest",
      "run without an account, as the GENESIS guest user (find only); required when no credentials are set, refused with any",
    )
    .addOption(
      // No .default(): an omitted --language is not sent, exactly like the library,
      // and GENESIS answers in German.
      new Option("--language <lang>", "response language (server default: de)").choices([...LANGUAGES]),
    )
    .option(
      "--pagelength <n>",
      `max list results for find/catalogue (1..${MAX_PAGELENGTH}; ignored by data/metadata)`,
      parseBoundedInt(1, MAX_PAGELENGTH),
    )
    .option(
      "--timeout <ms>",
      "time limit per request in ms, whole response included (0 = no timeout)",
      parseBoundedInt(0, MAX_TIMEOUT_MS),
    )
    .option("--user-agent <ua>", "User-Agent header value", parseHeaderValue)
    .option(
      "--max-retries <n>",
      "retries for transient 429/503 responses (0..10; each waits 200 ms × attempt or the server's longer Retry-After, up to 30 s)",
      parseBoundedInt(0, MAX_RETRIES),
    )
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      parseIntArg,
    )
    .option(
      "--log-format <format>",
      `how errors, warnings and notes are written to stderr: text (log4j style: time, level, [topic], message) or jsonl (one JSON object per line: ts, level, topic, msg); default ${DEFAULT_LOG_FORMAT}`,
      parseLogFormat,
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .option("-o, --output <file>", "write output (JSON, or a download) to this file; `-` means stdout", parseNonEmpty)
    .option("--force", "overwrite the --output file if it already exists")
    .showHelpAfterError();

  // Seed each credential flag from its env var (blank treated as unset), with the
  // value source "env". commander treats these as the option's value, which an
  // explicit flag on the command line overrides during parse (source "cli"):
  // flag > env var > unset, per field. The credentials file (`destatis config`) comes
  // after both, as a whole: `action()` reads it only when they give no credential.
  const env = deps.env ?? process.env;
  for (const [key, name] of Object.entries(CREDENTIAL_ENV_VARS)) {
    const value = readEnv(env, name);
    if (value !== undefined) program.setOptionValueWithSource(key, value, "env");
  }

  registerHelloCommands(program, deps);
  registerFindCommand(program, deps);
  registerCatalogueCommands(program, deps);
  registerMetadataCommands(program, deps);
  registerDataCommands(program, deps);
  registerConfigCommands(program, deps);

  return program;
}
