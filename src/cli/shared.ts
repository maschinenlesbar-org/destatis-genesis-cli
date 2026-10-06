// Shared helpers used across CLI command groups: option parsers, credential
// resolution, the global-option -> client-option mapping, and the two
// result-rendering paths (JSON and raw download).

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "./io.js";
import { cleartextProblem, DEFAULT_BASE_URL, type RawResponse } from "../client/engine.js";
import type { DestatisClientOptions } from "../client/client.js";
import { DestatisError, DestatisUsageError, DestatisValidationError } from "../client/errors.js";
import {
  BASE_URL_USERINFO_PROBLEM,
  baseUrlProblem,
  CREDENTIAL_PAIR_PROBLEM,
  credentialProblem,
  CREDENTIALS_REQUIRED_PROBLEM,
  headerValueProblem,
  intRangeProblem,
  nonBlankProblem,
  type Problem,
} from "../client/validate.js";
import type { Language } from "../client/params.js";

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

/** Throw the library's reason for an invalid value as a commander usage error. */
function check<T>(value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/** commander value-parser: a non-empty (after trimming) string — the library's rule. */
export function parseNonEmpty(value: string): string {
  return check(value, nonBlankProblem);
}

/**
 * commander value-parser for --base-url: the library's `baseUrlProblem` (an
 * absolute http/https URL without userinfo, query, fragment or whitespace).
 * Rejecting at parse time yields the conventional usage exit code (2); for an
 * embedded credential the CLI adds which flags to use instead.
 */
export function parseBaseUrl(value: string): string {
  const reason = baseUrlProblem(value);
  if (reason === BASE_URL_USERINFO_PROBLEM) {
    throw new InvalidArgumentError(`${reason} Use --token or --username/--password.`);
  }
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * commander value-parser for a value that ends up in an HTTP header (the
 * User-Agent): the library's `headerValueProblem` — non-blank, no control
 * characters (CR/LF included), nothing above U+00FF. Rejected here as a usage
 * error instead of Node's opaque "Invalid character in header content".
 */
export function parseHeaderValue(value: string): string {
  return check(value, headerValueProblem);
}

/**
 * commander value-parser for a credential (`--token`, `--username`,
 * `--password`, and the env vars): the library's `credentialProblem` — a valid
 * header value with no leading or trailing whitespace. A blank credential flag
 * is refused too (a blank `--token ""` silently cancelled a valid env token).
 */
export function parseCredential(value: string): string {
  return check(value, credentialProblem);
}

/**
 * Build the commander value-parser for a secret flag (`--token`, `--username`,
 * `--password`): the library's `credentialProblem`, like {@link parseCredential},
 * but a rejection never repeats the value. Commander words an `InvalidArgumentError`
 * as `option '--password <pass>' argument '<the value>' is invalid`, which put a
 * password pasted with a trailing space on stderr; this parser throws a
 * `DestatisUsageError` naming the flag and the reason only (exit 2 all the same).
 */
export function parseSecret(flags: string): (value: string) => string {
  return (value: string) => {
    const reason = credentialProblem(value);
    if (reason !== undefined) throw new DestatisUsageError(`option '${flags}' is invalid: ${reason}`);
    return value;
  };
}

/**
 * Build a commander value-parser for an integer constrained to [min, max]: the
 * string is parsed here, the range is the library's rule (`intRangeProblem`).
 */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  const problem = intRangeProblem(min, max);
  return (value: string) => check(parseIntArg(value), problem);
}

export interface GlobalOptions {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  language?: Language;
  pagelength?: number;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
  compact?: boolean;
  output?: string;
  force?: boolean;
}

/** A non-blank string option value, unchanged; undefined otherwise. */
function nonBlank(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Credentials resolved from the global options (flags already seeded from env). */
export interface ResolvedCredentials {
  token?: string;
  username?: string;
  password?: string;
  /** True when a usable credential (a token, or a username+password pair) is present. */
  present: boolean;
}

/** Which credential options were given as flags on the command line (not seeded from env). */
export interface CredentialSources {
  token?: boolean;
  username?: boolean;
  password?: boolean;
}

/**
 * Resolve the credential flags into a normalized form. A token wins over
 * username/password — except that a `--username`/`--password` **flag** beats a
 * token that only came from `DESTATIS_API_TOKEN`: the account named on the
 * command line is the one the user means, so an env token must not silently
 * authenticate as someone else. (A `--token` flag beats an env username/password;
 * a `--token` flag together with a `--username`/`--password` flag is refused by
 * {@link action} before this runs.) Per field, a flag beats its variable, so
 * `--username` combines with `DESTATIS_PASSWORD`.
 * Precedence only: a lone username or password is passed on as is, and the
 * library's pair rule rejects it when the client is built (see {@link action}).
 * No credentials at all is allowed here — the library rejects an account-only
 * call without them, and {@link action} rewords that error.
 */
export function resolveCredentials(
  global: GlobalOptions,
  fromCli: CredentialSources = {},
): ResolvedCredentials {
  const pairFromCli = !fromCli.token && (fromCli.username === true || fromCli.password === true);
  const token = pairFromCli ? undefined : nonBlank(global.token);
  if (token) return { token, present: true };

  const username = nonBlank(global.username);
  const password = nonBlank(global.password);
  return {
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    present: username !== undefined && password !== undefined,
  };
}

/** The environment variable each credential option is seeded from (program.ts). */
export const CREDENTIAL_ENV_VARS = {
  token: "DESTATIS_API_TOKEN",
  username: "DESTATIS_USERNAME",
  password: "DESTATIS_PASSWORD",
} as const;

/**
 * Check the credential values a command is about to use that came from an
 * environment variable. Env values are seeded via setOptionValueWithSource, which
 * does NOT run commander's value-parsers, so they are checked here, with the
 * library's `credentialProblem`, and only when used: help, `--version` and `hello`
 * never fail on a variable, and neither does a run whose flag overrides it (flag >
 * env var). A rejection (control characters, characters above U+00FF,
 * leading/trailing whitespace) is a usage error (exit 2) naming the variable —
 * never its value — instead of reaching Node's HTTP layer as an opaque
 * ERR_INVALID_CHAR "Unexpected error".
 */
export function checkEnvCredentials(creds: ResolvedCredentials, sources: Record<keyof typeof CREDENTIAL_ENV_VARS, string | undefined>): void {
  for (const key of ["token", "username", "password"] as const) {
    const value = creds[key];
    if (value === undefined || sources[key] !== "env") continue;
    const reason = credentialProblem(value);
    if (reason !== undefined) {
      throw new DestatisUsageError(reason.replace(/^Value/, `Environment variable ${CREDENTIAL_ENV_VARS[key]}`));
    }
  }
}

/**
 * Build the client, rewording the library's credential-pair error with the
 * flags and env vars that supply the pair.
 */
function createClient(deps: CliDeps, options: DestatisClientOptions): ReturnType<CliDeps["createClient"]> {
  try {
    return deps.createClient(options);
  } catch (err) {
    if (err instanceof DestatisValidationError && err.message.endsWith(CREDENTIAL_PAIR_PROBLEM)) {
      throw new DestatisUsageError(
        "Provide BOTH --username and --password (or use --token). " +
          "Env: DESTATIS_USERNAME + DESTATIS_PASSWORD, or DESTATIS_API_TOKEN.",
        { cause: err },
      );
    }
    throw err;
  }
}

/** Translate resolved global CLI options + credentials into client options. */
export function toClientOptions(global: GlobalOptions, creds: ResolvedCredentials): DestatisClientOptions {
  const options: DestatisClientOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  if (creds.token !== undefined) options.token = creds.token;
  if (creds.username !== undefined) options.username = creds.username;
  if (creds.password !== undefined) options.password = creds.password;
  return options;
}

/**
 * Write bytes to the --output file, guarding against an accidental overwrite and
 * wrapping raw filesystem errors in a typed usage error. Refuses to clobber an
 * existing file — or to write through a symlink, dangling or not — unless --force
 * is set (fail-secure: no silent data loss), and
 * turns an ENOENT/EISDIR/EACCES from writeFile into a clean DestatisUsageError
 * instead of an untyped "Unexpected error: ENOENT: …".
 */
function writeOutputFile(deps: CliDeps, global: GlobalOptions, path: string, data: Buffer): void {
  const refuse = () =>
    new DestatisUsageError(
      `Refusing to overwrite existing file "${path}". Pass --force to overwrite, or choose a different --output path.`,
    );
  const force = global.force === true;
  if (!force && deps.io.fileExists(path)) throw refuse();
  try {
    // Without --force the write is an exclusive create, so a symlink (even a
    // dangling one) or a file that appeared since the check is refused too.
    deps.io.writeFile(path, data, force);
  } catch (err) {
    if (!force && (err as NodeJS.ErrnoException | undefined)?.code === "EEXIST") throw refuse();
    const reason = err instanceof Error ? err.message : String(err);
    throw new DestatisUsageError(`Could not write to "${path}": ${reason}`);
  }
}

/**
 * Escape the control characters JSON.stringify leaves raw. It escapes C0 (including
 * ESC) but not DEL or the C1 range U+0080–U+009F, and terminals may act on those —
 * U+009B is the 8-bit form of CSI. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c >= 0x7f && c <= 0x9f) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

/**
 * JSON.stringify, pretty or compact. A deeply nested value (a hostile or broken
 * response) overflows the stack — the pretty form far sooner than the compact one,
 * which is why the message suggests --compact. The RangeError becomes a
 * DestatisError so the CLI prints a clear message instead of "Unexpected error:
 * Maximum call stack size exceeded".
 */
function stringifyJson(value: unknown, compact: boolean): string {
  try {
    return compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new DestatisError(
        compact
          ? "The response is nested too deeply to print."
          : "The response is nested too deeply to pretty-print; try --compact.",
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * True when --output names a file. `-o -` means stdout, as in other CLIs (P12): it used
 * to create a file named "-".
 */
function toFile(global: GlobalOptions): global is GlobalOptions & { output: string } {
  return typeof global.output === "string" && global.output !== "-";
}

/**
 * Render a JSON value, pretty by default and compact with --compact. Writes to
 * the file given by --output (with a short stderr confirmation so stdout stays
 * clean for piping), or to stdout otherwise.
 */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(stringifyJson(value, global.compact === true));
  if (toFile(global)) {
    const data = Buffer.from(text + "\n", "utf8");
    writeOutputFile(deps, global, global.output, data);
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
  if (toFile(global)) {
    writeOutputFile(deps, global, global.output, response.data);
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

/** The root program: credential options and their sources live on it. */
function rootCommand(command: Command): Command {
  let c = command;
  while (c.parent) c = c.parent;
  return c;
}

/**
 * Warn (once, to stderr) when a credential arrived on the command line rather
 * than via its env var. Argv is visible in the process table (ps / /proc) and is
 * persisted in shell history, so a flag-supplied credential — especially the
 * account *password* — is exposed to other local users and to disk. The env var
 * is the preferred path (and takes effect whenever the flag is absent).
 *
 * commander records an explicit flag as source "cli"; an env value seeded via
 * setOptionValue has source undefined, so this fires only for the argv path and
 * never for the env path. The credential value itself is never printed.
 */
function warnArgvCredentials(deps: CliDeps, command: Command): void {
  const root = rootCommand(command);
  const flagged: string[] = [];
  const check: Array<{ opt: string; env: string }> = [
    { opt: "token", env: "DESTATIS_API_TOKEN" },
    { opt: "username", env: "DESTATIS_USERNAME" },
    { opt: "password", env: "DESTATIS_PASSWORD" },
  ];
  for (const { opt, env } of check) {
    if (root.getOptionValueSource(opt) === "cli") flagged.push(`--${opt} (env ${env})`);
  }
  if (flagged.length > 0) {
    deps.io.err(
      `Warning: credential(s) passed on the command line are visible in the process ` +
        `list and shell history. Prefer the environment variable(s): ${flagged.join(", ")}.`,
    );
  }
}

/**
 * Warn (once per run, on stderr) when the requests go to a remote host over plain
 * `http:` (P20): the library's `cleartextProblem` for the effective base URL
 * (`--base-url`, else the default), naming what travels with them — "the token" or
 * "the login" (username and password) when the command sends credentials. Called
 * after the options and credentials are checked, right before the command's first
 * request, so help, `--version` and usage errors never warn. Never prints a value.
 */
function warnCleartext(deps: CliDeps, global: GlobalOptions, creds: ResolvedCredentials): void {
  const secrets = creds.token !== undefined ? ["the token"] : creds.present ? ["the login"] : [];
  const problem = cleartextProblem(global.baseUrl ?? DEFAULT_BASE_URL, secrets);
  if (problem !== undefined) deps.io.err(`warning: ${problem}`);
}

/**
 * Run a command body, rewording the library's "this endpoint needs an account"
 * error with the flags and env vars that supply credentials, and the signup URL.
 */
async function withCredentialsHint(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (err instanceof DestatisValidationError && err.message.endsWith(CREDENTIALS_REQUIRED_PROBLEM)) {
      throw new DestatisUsageError(
        "This command needs credentials. Set --token (env DESTATIS_API_TOKEN) " +
          "or --username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD). " +
          "A free account is available at https://www-genesis.destatis.de.",
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Wrap an async command action with credential resolution and client
 * construction. The callback receives a context (client + resolved global
 * options + this command's options) and the positional args. Which commands need
 * credentials is the library's rule: an account-only call rejects before any
 * request, and the error is reworded here with the flags and env vars.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
  options: { credentials?: boolean } = {},
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    // A command that sends no credentials (`hello`) neither reads nor checks them, so
    // a malformed or half-set variable can't stop it.
    if (options.credentials === false) {
      const client = deps.createClient(toClientOptions(global, { present: false }));
      warnArgvCredentials(deps, command);
      warnCleartext(deps, global, { present: false });
      await fn({ client, global, opts: command.opts() }, positionals);
      return;
    }
    const root = rootCommand(command);
    const sources = {
      token: root.getOptionValueSource("token"),
      username: root.getOptionValueSource("username"),
      password: root.getOptionValueSource("password"),
    };
    // --token and --username/--password on one command line name two different logins;
    // which one is meant can't be told, so neither is picked.
    if (sources.token === "cli" && (sources.username === "cli" || sources.password === "cli")) {
      throw new DestatisUsageError(
        "--token cannot be combined with --username/--password: pass either a token or a username and password.",
      );
    }
    const creds = resolveCredentials(global, {
      token: sources.token === "cli",
      username: sources.username === "cli",
      password: sources.password === "cli",
    });
    checkEnvCredentials(creds, sources);
    // A half username/password pair gets the library's pair error, reworded.
    const client = createClient(deps, toClientOptions(global, creds));
    if (creds.present) warnArgvCredentials(deps, command);
    warnCleartext(deps, global, creds);
    await withCredentialsHint(() => fn({ client, global, opts: command.opts() }, positionals));
  };
}

/** Common list-request params derived from global options (language, pagelength). */
export function commonListParams(global: GlobalOptions): { language?: Language; pagelength?: number } {
  const params: { language?: Language; pagelength?: number } = {};
  if (global.language !== undefined) params.language = global.language;
  if (global.pagelength !== undefined) params.pagelength = global.pagelength;
  return params;
}
