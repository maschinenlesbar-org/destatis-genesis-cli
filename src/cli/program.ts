// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { DestatisClient } from "../client/client.js";
import { parseIntArg, parseBoundedInt, parseHeaderValue } from "./shared.js";
import { registerHelloCommands } from "./commands/hello.js";
import { registerFindCommand } from "./commands/find.js";
import { registerCatalogueCommands } from "./commands/catalogue.js";
import { registerMetadataCommands } from "./commands/metadata.js";
import { registerDataCommands } from "./commands/data.js";

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

/** Default dependencies: real client + real stdout/stderr/filesystem + real env. */
export const defaultDeps: CliDeps = {
  io: defaultIO,
  createClient: (options) => new DestatisClient(options),
  env: process.env,
};

/**
 * Read a credential env var, trimmed. A missing, empty, or whitespace-only value
 * is treated as unset (returns undefined) so it never seeds a blank credential.
 */
function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();

  program
    .name("destatis")
    .description(
      "CLI for the DESTATIS GENESIS-Online REST API " +
        "(https://genesis.destatis.de) — Germany's official-statistics database. " +
        "Needs a free account: pass --token (env DESTATIS_API_TOKEN) or " +
        "--username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD). " +
        "Register at https://www-genesis.destatis.de; `destatis hello` needs no credentials.",
    )
    .version(VERSION)
    .option("--base-url <url>", "API base URL", "https://genesis.destatis.de")
    .option("--token <token>", "GENESIS API token (env: DESTATIS_API_TOKEN)", parseHeaderValue)
    .option("--username <user>", "GENESIS account username (env: DESTATIS_USERNAME)", parseHeaderValue)
    .option("--password <pass>", "GENESIS account password (env: DESTATIS_PASSWORD)", parseHeaderValue)
    .addOption(
      new Option("--language <lang>", "response language").choices(["de", "en"]).default("de"),
    )
    .option("--pagelength <n>", "max list results (1..25000)", parseBoundedInt(1, 25000))
    .option("--timeout <ms>", "per-request timeout in milliseconds", parseIntArg)
    .option("--user-agent <ua>", "User-Agent header value", parseHeaderValue)
    .option("--max-retries <n>", "retries for transient 429/503 responses", parseIntArg)
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      parseIntArg,
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .option("-o, --output <file>", "write output (JSON, or a download) to this file")
    .showHelpAfterError();

  // Seed each credential flag from its env var (trimmed; blank treated as unset).
  // commander treats these as the option's value, which an explicit flag on the
  // command line overrides during parse: flag > env var > unset, per field.
  const env = deps.env ?? process.env;
  const tokenEnv = readEnv(env, "DESTATIS_API_TOKEN");
  const userEnv = readEnv(env, "DESTATIS_USERNAME");
  const passEnv = readEnv(env, "DESTATIS_PASSWORD");
  if (tokenEnv !== undefined) program.setOptionValue("token", tokenEnv);
  if (userEnv !== undefined) program.setOptionValue("username", userEnv);
  if (passEnv !== undefined) program.setOptionValue("password", passEnv);

  registerHelloCommands(program, deps);
  registerFindCommand(program, deps);
  registerCatalogueCommands(program, deps);
  registerMetadataCommands(program, deps);
  registerDataCommands(program, deps);

  return program;
}
