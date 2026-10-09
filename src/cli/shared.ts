// Shared helpers used across CLI command groups: option parsers, credential
// resolution, the global-option -> client-option mapping, and the two
// result-rendering paths (JSON and raw download).

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import { OutputError, logOf, type CliDeps } from "./io.js";
import { CredentialsFileError } from "./credentials.js";
import { cleartextProblem, DEFAULT_BASE_URL, type RawResponse } from "../client/engine.js";
import type { DestatisClientOptions } from "../client/client.js";
import { DestatisError, DestatisUsageError, DestatisValidationError } from "../client/errors.js";
import {
  BASE_URL_USERINFO_PROBLEM,
  GUEST_WITH_CREDENTIALS_PROBLEM,
  NO_CREDENTIALS_PROBLEM,
  TOKEN_WITH_LOGIN_PROBLEM,
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
  guest?: boolean;
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
 * Resolve the credential options (flags already seeded from env) into a normalized
 * form. Per field a flag beats its variable — so `--username` combines with
 * `DESTATIS_PASSWORD` — and a blank variable counts as unset. Nothing else is
 * picked: every credential set, from any source, is passed on, and the library
 * decides — a token together with a username or password is refused
 * (`TOKEN_WITH_LOGIN_PROBLEM`), and so is half a pair; {@link action} rewords both.
 * No credentials at all is allowed here — without `--guest` the library refuses
 * that too. (`fromCli` is no longer used; kept so callers compile.)
 */
export function resolveCredentials(
  global: GlobalOptions,
  _fromCli: CredentialSources = {},
): ResolvedCredentials {
  const token = nonBlank(global.token);
  const username = nonBlank(global.username);
  const password = nonBlank(global.password);
  return {
    ...(token !== undefined ? { token } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    present: token !== undefined || (username !== undefined && password !== undefined),
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

/** How to store the login once, as the messages that ask for credentials name it. */
export const STORE_CREDENTIALS_HINT = "store them once with `destatis config set token` (or `username` and `password`)";

/** The usage error for a run with neither credentials nor `--guest` (no silent guest access). */
export const NO_CREDENTIALS_MESSAGE =
  "No credentials. Set --token (env DESTATIS_API_TOKEN) or --username/--password " +
  `(env DESTATIS_USERNAME / DESTATIS_PASSWORD), ${STORE_CREDENTIALS_HINT}, or pass --guest to run without an account ` +
  "(guest access covers `find` only). A free account is available at https://www-genesis.destatis.de.";

/** The value source `action()` gives a credential read from the credentials file. */
const FILE_SOURCE = "file";

/**
 * Where each set credential came from, as the user would name it: `--token`,
 * `DESTATIS_API_TOKEN`, or `the stored token` (the credentials file).
 */
function credentialSourceNames(
  creds: ResolvedCredentials,
  sources: Partial<Record<keyof typeof CREDENTIAL_ENV_VARS, string | undefined>>,
): string[] {
  return (["token", "username", "password"] as const)
    .filter((key) => creds[key] !== undefined)
    .map((key) =>
      sources[key] === "env" ? CREDENTIAL_ENV_VARS[key] : sources[key] === FILE_SOURCE ? `the stored ${key}` : `--${key}`,
    );
}

/**
 * The login from the credentials file (`destatis config`), for a run whose flags and
 * `DESTATIS_*` variables give no credential at all: `undefined` when `deps` has no
 * store (tests that don't ask for one) or the file holds none of the three. Read here
 * and only here, so a problem with the file (a link, mode 644, broken JSON — a
 * `DestatisError`, exit 1) never stands in the way of a login given another way.
 * What it holds is passed on as it is, like flags and variables: a token next to a
 * username or password, or half a pair, is the library's error, reworded by
 * `createClient`. A stored value the library would refuse (hand-edited into the file)
 * is an error naming the credential and the fix, never its value. Every value read
 * is added to the run's redaction (`deps.redact`): the server may echo it back.
 */
function storedCredentials(deps: CliDeps): ResolvedCredentials | undefined {
  if (deps.credentials === undefined) return undefined;
  const store = deps.credentials();
  const all = store.all();
  const picked: GlobalOptions = {};
  for (const key of ["token", "username", "password"] as const) {
    const value = nonBlank(all[key]);
    if (value === undefined) continue;
    const reason = credentialProblem(value);
    if (reason !== undefined) {
      throw new CredentialsFileError(
        `The ${key} stored in ${store.path} cannot be sent: ${reason} Replace it: destatis config set ${key}`,
      );
    }
    deps.redact?.(value);
    picked[key] = value;
  }
  if (picked.token === undefined && picked.username === undefined && picked.password === undefined) return undefined;
  return resolveCredentials(picked);
}

/**
 * Build the client, rewording the library's credential errors (a token with a
 * login, a half pair, no access mode, guest with credentials) with the flags and
 * env vars — naming where each credential came from, never its value.
 */
function createClient(
  deps: CliDeps,
  options: DestatisClientOptions,
  setBy: readonly string[] = [],
  fromFile = false,
): ReturnType<CliDeps["createClient"]> {
  try {
    return deps.createClient(options);
  } catch (err) {
    if (err instanceof DestatisValidationError && err.message.endsWith(TOKEN_WITH_LOGIN_PROBLEM)) {
      throw new DestatisUsageError(
        `A token cannot be combined with a username/password (set: ${setBy.join(", ")}). ` +
          "Pass either --token (env DESTATIS_API_TOKEN) or --username/--password " +
          "(env DESTATIS_USERNAME / DESTATIS_PASSWORD), not both." +
          (fromFile ? " Remove the stored one you don't use: `destatis config unset token` (or `username` and `password`)." : ""),
        { cause: err },
      );
    }
    if (err instanceof DestatisValidationError && err.message.endsWith(CREDENTIAL_PAIR_PROBLEM)) {
      throw new DestatisUsageError(
        "Provide BOTH --username and --password (or use --token). " +
          "Env: DESTATIS_USERNAME + DESTATIS_PASSWORD, or DESTATIS_API_TOKEN." +
          (fromFile
            ? ` The credentials file holds no ${options.username === undefined ? "username" : "password"}: ` +
              `\`destatis config set ${options.username === undefined ? "username" : "password"}\` stores it.`
            : ""),
        { cause: err },
      );
    }
    if (err instanceof DestatisValidationError && err.message.endsWith(NO_CREDENTIALS_PROBLEM)) {
      throw new DestatisUsageError(NO_CREDENTIALS_MESSAGE, { cause: err });
    }
    if (err instanceof DestatisValidationError && err.message.endsWith(GUEST_WITH_CREDENTIALS_PROBLEM)) {
      throw new DestatisUsageError("--guest cannot be combined with credentials.", { cause: err });
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
  if (global.guest === true) options.guest = true;
  return options;
}

/**
 * Write bytes to the --output file, guarding against an accidental overwrite and
 * wrapping raw filesystem errors in a typed usage error. Refuses to clobber an
 * existing file — or to write through a symlink, dangling or not — unless --force
 * is set (fail-secure: no silent data loss), and
 * turns an ENOENT/EISDIR/EACCES from writeFile into a clean `OutputError` (a
 * DestatisUsageError, exit 2, logged under `destatis.output`) instead of an untyped
 * "Unexpected error: ENOENT: …".
 */
function writeOutputFile(deps: CliDeps, global: GlobalOptions, path: string, data: Buffer): void {
  const refuse = () =>
    new OutputError(
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
    throw new OutputError(`Could not write to "${path}": ${reason}`, { cause: err });
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
    logOf(deps).info("output", `Wrote ${data.length} bytes to ${global.output}`);
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
    logOf(deps).info("output", `Wrote ${response.data.length} bytes to ${global.output}${typeNote}`);
  } else {
    deps.io.outBinary(response.data);
    logOf(deps).info("output", `Wrote ${response.data.length} bytes to stdout${typeNote}`);
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
    logOf(deps).warn(
      "cli",
      `credential(s) passed on the command line are visible in the process ` +
        `list and shell history. Prefer the environment variable(s): ${flagged.join(", ")}, ` +
        "or store them once with `destatis config set`.",
    );
  }
}

/**
 * Warn (once per run, a WARN record of `destatis.http`) when the requests go to a remote host over plain
 * `http:` (P20): the library's `cleartextProblem` for the effective base URL
 * (`--base-url`, else the default), naming what travels with them — "the token" or
 * "the login" (username and password) when the command sends credentials. Called
 * after the options and credentials are checked, right before the command's first
 * request, so help, `--version` and usage errors never warn. Never prints a value.
 */
function warnCleartext(deps: CliDeps, global: GlobalOptions, creds: ResolvedCredentials): void {
  const secrets = creds.token !== undefined ? ["the token"] : creds.present ? ["the login"] : [];
  const problem = cleartextProblem(global.baseUrl ?? DEFAULT_BASE_URL, secrets);
  if (problem !== undefined) logOf(deps).warn("http", problem);
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
          `or --username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD), or ${STORE_CREDENTIALS_HINT}. ` +
          "A free account is available at https://www-genesis.destatis.de.",
        { cause: err },
      );
    }
    throw err;
  }
}

/** The command as typed after the program name (`catalogue tables`, `logincheck`). */
function commandPath(command: Command): string {
  const names: string[] = [];
  for (let c: Command | null = command; c?.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

/**
 * `--guest` is an explicit choice of anonymous access, so a credential next to it —
 * a flag, or a set variable — is a contradiction, not something to pick from: a usage
 * error naming the flags and variables (never their values).
 */
function checkGuestAlone(global: GlobalOptions, root: Command): void {
  if (global.guest !== true) return;
  const given: string[] = [];
  for (const key of ["token", "username", "password"] as const) {
    if (nonBlank(global[key]) === undefined) continue;
    given.push(root.getOptionValueSource(key) === "env" ? CREDENTIAL_ENV_VARS[key] : `--${key}`);
  }
  if (given.length > 0) {
    throw new DestatisUsageError(
      `--guest cannot be combined with credentials (${given.join(", ")} set). ` +
        "Drop --guest to use them, or unset them to run as guest.",
    );
  }
}

/**
 * Wrap an async command action with credential resolution and client
 * construction. The callback receives a context (client + resolved global
 * options + this command's options) and the positional args.
 *
 * Access is explicit (no silent guest): a command that sends credentials runs with
 * credentials (flags or env vars) or with `--guest`; neither is a usage error
 * naming both ways (the library's `NO_CREDENTIALS_PROBLEM`, reworded), and so is
 * `--guest` together with a credential. `options.guest` marks the commands guest
 * access covers (`find`); any other is refused with `--guest` before any request.
 * `options.credentials: false` is a command that sends none (`hello`): it needs
 * neither, but still refuses `--guest` with a credential.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
  options: { credentials?: boolean; guest?: boolean } = {},
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    const root = rootCommand(command);
    checkGuestAlone(global, root);
    // A command that sends no credentials (`hello`) neither reads nor checks them, so
    // a malformed or half-set variable can't stop it. It always runs as guest.
    if (options.credentials === false) {
      const client = deps.createClient({ ...toClientOptions(global, { present: false }), guest: true });
      warnArgvCredentials(deps, command);
      warnCleartext(deps, global, { present: false });
      await fn({ client, global, opts: command.opts() }, positionals);
      return;
    }
    if (global.guest === true && options.guest !== true) {
      throw new DestatisUsageError(
        `\`${commandPath(command)}\` needs an account; --guest covers \`find\` only. ` +
          "Set --token (env DESTATIS_API_TOKEN) or --username/--password (env DESTATIS_USERNAME / DESTATIS_PASSWORD), " +
          `or ${STORE_CREDENTIALS_HINT}.`,
      );
    }
    let sources: Record<keyof typeof CREDENTIAL_ENV_VARS, string | undefined> = {
      token: root.getOptionValueSource("token"),
      username: root.getOptionValueSource("username"),
      password: root.getOptionValueSource("password"),
    };
    let creds: ResolvedCredentials = global.guest === true ? { present: false } : resolveCredentials(global);
    checkEnvCredentials(creds, sources);
    // flags > DESTATIS_* variables (per field) > the credentials file > none. The file
    // is a source of its own, not a fallback per field: it is read only when the flags
    // and variables give no credential at all, so one login is never pieced together
    // from two places — and a problem with the file never stops a run that has one.
    // `--guest` doesn't read it either.
    let fromFile = false;
    if (global.guest !== true && creds.token === undefined && creds.username === undefined && creds.password === undefined) {
      const stored = storedCredentials(deps);
      if (stored !== undefined) {
        creds = stored;
        sources = { token: FILE_SOURCE, username: FILE_SOURCE, password: FILE_SOURCE };
        fromFile = true;
      }
    }
    // A token together with a username or password (from any source), no credentials
    // without --guest, or half a username/password pair: the library refuses, and the
    // error is reworded here (exit 2, before any request).
    const client = createClient(deps, toClientOptions(global, creds), credentialSourceNames(creds, sources), fromFile);
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
