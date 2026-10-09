// `destatis config` — the GENESIS login kept in a credentials file of its own, the
// same mechanism as openka-cli's `ka config`. A value goes in through a prompt without
// echo or through stdin, never as an argument, so it reaches neither shell history
// nor `ps`; it comes out masked unless asked for in full.

import type { Command } from "commander";
import { DestatisError, DestatisUsageError } from "../../client/errors.js";
import { credentialProblem } from "../../client/validate.js";
import { CONFIG_DIR_NAME, credentialValueProblem, maskCredential, type CredentialStore } from "../credentials.js";
import { logOf, type CliDeps } from "../io.js";
import type { GlobalOptions } from "../shared.js";

/**
 * The credentials this program knows: a token, or a username and password — the
 * same login as `--token` / `--username` / `--password`.
 */
export const CREDENTIAL_NAMES = ["token", "username", "password"] as const;

/**
 * The credential name a config command was given, checked in the action rather than by
 * a commander argument parser: commander repeats a rejected argument (`argument
 * 'Hunter2…' is invalid`) and every surplus one (`too many arguments … got 2: …`), and
 * a password typed in place of the name would end up in the log. The usage errors here
 * name the valid names, never what was typed.
 */
function credentialNameArg(command: Command, usage: string): string {
  const [name, ...rest] = command.args;
  if (rest.length > 0) throw new DestatisUsageError(`${usage} takes one name: ${CREDENTIAL_NAMES.join(", ")}.`);
  if (name === undefined || !(CREDENTIAL_NAMES as readonly string[]).includes(name)) {
    throw new DestatisUsageError(`Not a credential name this program knows: expected ${CREDENTIAL_NAMES.join(", ")}.`);
  }
  return name;
}

/**
 * Why `value` cannot be stored, or undefined: the store's rule (blank, a line break
 * or another control character), then the library's `credentialProblem` — the rule
 * `--token`, `--username` and `--password` go through (no leading or trailing
 * whitespace, nothing above U+00FF). Spaces inside are fine: a password may hold them.
 */
function valueProblem(value: string): string | undefined {
  return credentialValueProblem(value) ?? credentialProblem(value);
}

function storeOf(deps: CliDeps): CredentialStore {
  if (deps.credentials === undefined) throw new DestatisError("This program was built without a credentials file.");
  return deps.credentials();
}

export function registerConfigCommands(program: Command, deps: CliDeps): void {
  const names = CREDENTIAL_NAMES.join(", ");
  const config = program
    .command("config")
    .description(
      `the GENESIS login, kept in a credentials file of its own: $XDG_CONFIG_HOME/${CONFIG_DIR_NAME}/credentials, ` +
        `else ~/.config/${CONFIG_DIR_NAME}/credentials (${names}); used when no flag and no DESTATIS_* variable gives a credential`,
    )
    // `config get --reveal -o token.txt` used to print the value on the terminal and write
    // no file. A secret written to a file is a job for `> file` and the user's own umask.
    .hook("preAction", (_config, command) => {
      const output = (command.optsWithGlobals() as GlobalOptions).output;
      if (output !== undefined && output !== "-") {
        throw new DestatisUsageError("destatis config prints to stdout only: --output is refused; redirect stdout instead.");
      }
    });

  config
    .command("set")
    .description(
      "store a credential: typed at a prompt without echo, or piped in (pass show genesis | destatis config set password) — never given as an argument",
    )
    .argument("<name>", names)
    // Commander's own "too many arguments" error repeats them — here, the secret.
    .allowExcessArguments(true)
    .action(async (_name: string, _options: unknown, command: Command) => {
      if (command.args.length > 1) {
        throw new DestatisUsageError(
          "destatis config set takes the name only: the value is read from a prompt or from stdin, never from the command line. " +
            "The one given is now in your shell history; if it is a secret, replace it there.",
        );
      }
      const name = credentialNameArg(command, "destatis config set");
      if (deps.io.readSecret === undefined) {
        throw new DestatisUsageError("No way to read a secret here: pipe it in, or run destatis config set on a terminal.");
      }
      // Line breaks at the end (a pipe's, a paste's) are dropped; nothing else is trimmed,
      // so what is stored is what will be sent.
      const value = (await deps.io.readSecret(`${name}: `)).replace(/[\r\n]+$/, "");
      const reason = valueProblem(value);
      if (reason !== undefined) throw new DestatisUsageError(`${reason} Nothing was stored.`);
      const store = storeOf(deps);
      store.set(name, value);
      logOf(deps).info("config", `Stored ${name} (${maskCredential(value, name)}) in ${store.path}.`);
    });

  config
    .command("get")
    .description("show a stored credential, masked (abcd…wxyz; **** for a password and below 20 characters) unless --reveal")
    .argument("<name>", names)
    .allowExcessArguments(true)
    .option("--reveal", "print the whole value, for a script that passes it on — it then is on your screen or in its log")
    .action(async (_name: string, options: { reveal?: boolean }, command: Command) => {
      const name = credentialNameArg(command, "destatis config get");
      const store = storeOf(deps);
      const value = store.get(name);
      if (value === undefined) throw new DestatisError(`No ${name} is stored in ${store.path}; destatis config set ${name} stores one.`);
      // --reveal prints the value as stored: the run's redaction (a credential from a flag
      // or a variable that happens to occur in it) would hand a script a wrong value with
      // exit 0.
      if (options.reveal === true) (deps.io.outRaw ?? deps.io.out)(value);
      else deps.io.out(maskCredential(value, name));
    });

  config
    .command("unset")
    .description("remove a stored credential")
    .argument("<name>", names)
    .allowExcessArguments(true)
    .action(async (_name: string, _options: unknown, command: Command) => {
      const name = credentialNameArg(command, "destatis config unset");
      const store = storeOf(deps);
      if (!store.unset(name)) throw new DestatisError(`No ${name} is stored in ${store.path}.`);
      logOf(deps).info("config", `Removed ${name} from ${store.path}.`);
    });

  config
    .command("list")
    .description("every stored credential, masked, and where the file is")
    .allowExcessArguments(true)
    .action(async (_options: unknown, command: Command) => {
      if (command.args.length > 0) throw new DestatisUsageError("destatis config list takes no arguments.");
      const store = storeOf(deps);
      const all = store.all();
      for (const name of Object.keys(all).sort()) deps.io.out(`${name}  ${maskCredential(all[name] as string, name)}`);
      logOf(deps).info("config", `Credentials file: ${store.path}`);
    });
}
