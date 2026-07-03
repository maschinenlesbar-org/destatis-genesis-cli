// Shared helpers used across CLI command groups: option parsers, credential
// resolution, the global-option -> client-option mapping, and the two
// result-rendering paths (JSON and raw download).

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "./io.js";
import type { RawResponse } from "../client/engine.js";
import type { DestatisClientOptions } from "../client/client.js";
import { DestatisUsageError } from "../client/errors.js";

/**
 * commander value-parser: a non-negative integer in plain decimal notation.
 *
 * Deliberately strict — Number() would happily coerce "0x10" (16), "1e3" (1000),
 * "0b11" (3), whitespace-padded values, and "" / "  " (both 0). We only accept an
 * unpadded run of ASCII digits so the "non-negative integer" promise holds.
 */
export function parseIntArg(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return n;
}

/** commander value-parser: a non-empty (after trimming) string. */
export function parseNonEmpty(value: string): string {
  if (value.trim() === "") {
    throw new InvalidArgumentError("Expected a non-empty value.");
  }
  return value;
}

/** Build a commander value-parser for an integer constrained to [min, max]. */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  return (value: string) => {
    const n = parseIntArg(value);
    if (n < min) throw new InvalidArgumentError(`Must be >= ${min}.`);
    if (n > max) throw new InvalidArgumentError(`Must be <= ${max}.`);
    return n;
  };
}

export interface GlobalOptions {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  language?: string;
  pagelength?: number;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
  compact?: boolean;
  output?: string;
}

function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/** Credentials resolved from the global options (flags already seeded from env). */
export interface ResolvedCredentials {
  token?: string;
  username?: string;
  password?: string;
  /** True when a usable credential (a token, or a username+password pair) is present. */
  present: boolean;
}

/**
 * Resolve the credential flags into a normalized form. A token wins over
 * username/password. Supplying only one of username/password is a usage error
 * (exit 2). No credentials at all is allowed here — commands that need auth
 * enforce presence via {@link action}'s `auth` guard.
 */
export function resolveCredentials(global: GlobalOptions): ResolvedCredentials {
  const token = trimmed(global.token);
  if (token) return { token, present: true };

  const username = trimmed(global.username);
  const password = trimmed(global.password);
  if (username && password) return { username, password, present: true };
  if (username || password) {
    throw new DestatisUsageError(
      "Provide BOTH --username and --password (or use --token). " +
        "Env: DESTATIS_USERNAME + DESTATIS_PASSWORD, or DESTATIS_API_TOKEN.",
    );
  }
  return { present: false };
}

/** Translate resolved global CLI options + credentials into client options. */
export function toClientOptions(global: GlobalOptions, creds: ResolvedCredentials): DestatisClientOptions {
  const options: DestatisClientOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  const ua = trimmed(global.userAgent);
  if (ua !== undefined) options.userAgent = ua;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  if (creds.token !== undefined) options.token = creds.token;
  if (creds.username !== undefined) options.username = creds.username;
  if (creds.password !== undefined) options.password = creds.password;
  return options;
}

/**
 * Render a JSON value, pretty by default and compact with --compact. Writes to
 * the file given by --output (with a short stderr confirmation so stdout stays
 * clean for piping), or to stdout otherwise.
 */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  if (global.output) {
    const data = Buffer.from(text + "\n", "utf8");
    deps.io.writeFile(global.output, data);
    deps.io.err(`Wrote ${data.length} bytes to ${global.output}`);
  } else {
    deps.io.out(text);
  }
}

/**
 * Render a raw (binary/text) download. Writes to the file given by --output, or
 * to stdout otherwise. Prints a short confirmation to stderr when writing a file
 * so stdout stays clean for piping. The confirmation reports the server's
 * Content-Type so the user can tell what the bytes actually are (e.g. a ZIP).
 */
export function renderRaw(deps: CliDeps, global: GlobalOptions, response: RawResponse): void {
  const typeNote = response.contentType ? ` (Content-Type: ${response.contentType})` : "";
  if (global.output) {
    deps.io.writeFile(global.output, response.data);
    deps.io.err(`Wrote ${response.data.length} bytes to ${global.output}${typeNote}`);
  } else {
    deps.io.outBinary(response.data);
    deps.io.err(`Wrote ${response.data.length} bytes to stdout${typeNote}`);
  }
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
}

/**
 * Wrap an async command action with credential resolution, an optional auth
 * guard, and client construction. The callback receives a context (client +
 * resolved global options + this command's options) and the positional args.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 * Pass `{ auth: false }` for commands that do not need credentials (e.g. `hello`).
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
  opts: { auth?: boolean } = {},
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    const creds = resolveCredentials(global);
    if (opts.auth !== false && !creds.present) {
      throw new DestatisUsageError(
        "This command needs credentials. Set --token (env DESTATIS_API_TOKEN) " +
          "or --username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD). " +
          "A free account is available at https://www-genesis.destatis.de.",
      );
    }
    const client = deps.createClient(toClientOptions(global, creds));
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}

/** Common list-request params derived from global options (language, pagelength). */
export function commonListParams(global: GlobalOptions): { language?: string; pagelength?: number } {
  const params: { language?: string; pagelength?: number } = {};
  if (global.language !== undefined) params.language = global.language;
  if (global.pagelength !== undefined) params.pagelength = global.pagelength;
  return params;
}
