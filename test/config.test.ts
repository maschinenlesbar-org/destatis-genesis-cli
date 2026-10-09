// `destatis config` and the credentials file: the GENESIS login kept apart from argv
// and the environment, the same mechanism as openka-cli's `ka config`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { run } from "../src/cli/run.js";
import { DestatisClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import { readSecretFrom } from "../src/cli/io.js";
import { CredentialStore, credentialValueProblem, maskCredential, resolveCredentialsPath } from "../src/cli/credentials.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse, untimed } from "./helpers.js";
import * as fx from "./fixtures.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const USERNAME = "alice.example";
/** Spaces inside: GENESIS and an HTTP header take them, so the store does too. */
const PASSWORD = "correct horse battery";
const VALUES: Record<string, string> = { token: TOKEN, username: USERNAME, password: PASSWORD };

/**
 * A CLI whose credentials file lives in a temporary directory, whose secret prompt
 * answers `secret`, and whose transport answers `responder` (logincheck's echo by
 * default) and never reaches the network.
 */
function makeCli(
  options: {
    env?: Record<string, string | undefined>;
    secret?: string;
    credentials?: boolean;
    responder?: (req: HttpRequest) => HttpResponse;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "destatis-config-"));
  const store = new CredentialStore(join(dir, "destatis-genesis", "credentials"));
  const out: string[] = [];
  const err: string[] = [];
  // Each helloworld endpoint's own answer, a search result for everything else.
  const mt = makeMockTransport(
    options.responder ??
      ((req) =>
        jsonResponse(req.url.includes("/logincheck") ? fx.loginOk : req.url.includes("/whoami") ? fx.whoami : fx.findResult)),
  );
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: () => undefined,
      fileExists: () => false,
      outBinary: () => undefined,
      ...(options.secret === undefined ? {} : { readSecret: async () => options.secret as string }),
    },
    createClient: (opts) => new DestatisClient({ ...opts, transport: mt.transport }),
    env: options.env ?? {},
    ...(options.credentials === false ? {} : { credentials: () => store }),
  };
  return { deps, out, err, mt, store, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

for (const name of ["token", "username", "password"]) {
  test(`config set ${name} stores the value from the prompt, mode 0600 in a 0700 directory, and shows it masked`, async () => {
    const value = VALUES[name] as string;
    // Only the 32-character token shows its ends; the username is shorter than 20, and a password never shows.
    const masked = name === "token" ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
    const cli = makeCli({ secret: `${value}\n` });
    try {
      assert.equal(await run(["config", "set", name], cli.deps), 0, cli.err.join("\n"));
      assert.equal(cli.store.get(name), value);
      assert.equal(statSync(cli.store.path).mode & 0o777, 0o600);
      assert.equal(statSync(join(cli.dir, "destatis-genesis")).mode & 0o777, 0o700);
      assert.ok(cli.err.join("\n").includes(`Stored ${name} (${masked}) in `), cli.err.join("\n"));
      assert.ok(!(cli.err.join("\n") + cli.out.join("\n")).includes(value));

      cli.out.length = 0;
      assert.equal(await run(["config", "get", name], cli.deps), 0);
      assert.deepEqual(cli.out, [masked]);
      cli.out.length = 0;
      assert.equal(await run(["config", "get", name, "--reveal"], cli.deps), 0);
      assert.deepEqual(cli.out, [value]);
      cli.out.length = 0;
      assert.equal(await run(["config", "list"], cli.deps), 0);
      assert.deepEqual(cli.out, [`${name}  ${masked}`]);
      assert.match(untimed(cli.err.join("\n")), /^INFO  \[destatis\.config\] Credentials file: .*destatis-genesis\/credentials/m);

      assert.equal(await run(["config", "unset", name], cli.deps), 0);
      assert.equal(cli.store.get(name), undefined);
      assert.equal(await run(["config", "unset", name], cli.deps), 1);
      assert.equal(await run(["config", "get", name], cli.deps), 1);
    } finally {
      cli.cleanup();
    }
  });
}

test("config list shows every stored credential, sorted and masked", async () => {
  const cli = makeCli();
  try {
    cli.store.set("username", USERNAME);
    cli.store.set("password", PASSWORD);
    assert.equal(await run(["config", "list"], cli.deps), 0);
    assert.deepEqual(cli.out, ["password  ****", "username  ****"]);
  } finally {
    cli.cleanup();
  }
});

test("config set never takes the value from the command line, and never repeats it", async () => {
  for (const [name, value] of [["token", TOKEN], ["password", "s3cr3t-Passw0rd"], ["username", "alice.example"]] as const) {
    const cli = makeCli({ secret: value });
    try {
      assert.equal(await run(["config", "set", name, value], cli.deps), 2, name);
      const err = cli.err.join("\n");
      assert.match(err, /takes the name only/);
      assert.ok(!err.includes(value), err);
      assert.equal(cli.store.get(name), undefined);
    } finally {
      cli.cleanup();
    }
  }
  const cli = makeCli({ secret: TOKEN });
  try {
    assert.equal(await run(["config", "set", "api-key"], cli.deps), 2, "an unknown name");
    assert.equal(cli.store.names().length, 0);
  } finally {
    cli.cleanup();
  }
});

test("config set without a way to read a secret refuses, and stores nothing", async () => {
  const cli = makeCli();
  try {
    assert.equal(await run(["config", "set", "token"], cli.deps), 2);
    assert.match(cli.err.join("\n"), /No way to read a secret here/);
    assert.equal(cli.store.get("token"), undefined);
  } finally {
    cli.cleanup();
  }
});

test("config set refuses a blank value, a line break, or what the library refuses — and stores nothing", async () => {
  for (const secret of ["", "   ", "\n", "two\nlines", "tab\u0000nul", " leading", "trailing ", "snow☃man"]) {
    const cli = makeCli({ secret });
    try {
      assert.equal(await run(["config", "set", "password"], cli.deps), 2, JSON.stringify(secret));
      assert.match(cli.err.join("\n"), /Nothing was stored/);
      assert.equal(cli.store.get("password"), undefined);
    } finally {
      cli.cleanup();
    }
  }
});

test("a password with spaces or a tab inside is stored and sent as it is", async () => {
  for (const secret of [PASSWORD, "tab\there-1234"]) {
    const cli = makeCli({ secret });
    try {
      assert.equal(await run(["config", "set", "password"], cli.deps), 0, JSON.stringify(secret));
      cli.store.set("username", USERNAME);
      assert.equal(await run(["logincheck"], cli.deps), 0, cli.err.join("\n"));
      assert.equal(cli.mt.last().headers?.["password"], secret);
    } finally {
      cli.cleanup();
    }
  }
});

test("a stored token is sent when no flag and no variable gives a credential", async () => {
  const cli = makeCli();
  try {
    cli.store.set("token", TOKEN);
    assert.equal(await run(["logincheck"], cli.deps), 0, cli.err.join("\n"));
    assert.equal(cli.mt.last().headers?.["username"], TOKEN);
    assert.equal(cli.mt.last().headers?.["password"], undefined);
  } finally {
    cli.cleanup();
  }
});

test("a stored username and password are sent when no flag and no variable gives a credential", async () => {
  const cli = makeCli();
  try {
    cli.store.set("username", USERNAME);
    cli.store.set("password", PASSWORD);
    assert.equal(await run(["find", "x"], cli.deps), 0, cli.err.join("\n"));
    assert.equal(cli.mt.last().headers?.["username"], USERNAME);
    assert.equal(cli.mt.last().headers?.["password"], PASSWORD);
  } finally {
    cli.cleanup();
  }
});

test("flags and variables come first, as a whole: the file is not read when they give any credential", async () => {
  const cli = makeCli();
  try {
    cli.store.set("username", USERNAME);
    cli.store.set("password", PASSWORD);
    // A token from a flag or a variable next to a stored login: no conflict, the file is not read.
    assert.equal(await run(["--token", TOKEN, "logincheck"], cli.deps), 0, cli.err.join("\n"));
    assert.equal(cli.mt.last().headers?.["username"], TOKEN);
    assert.equal(cli.mt.last().headers?.["password"], undefined);
    const viaEnv = { ...cli.deps, env: { DESTATIS_API_TOKEN: TOKEN } };
    assert.equal(await run(["logincheck"], viaEnv), 0, cli.err.join("\n"));
    assert.equal(cli.mt.last().headers?.["username"], TOKEN);
    // A login from the variables beats the stored one.
    const envLogin = { ...cli.deps, env: { DESTATIS_USERNAME: "envuser123", DESTATIS_PASSWORD: "envpass123" } };
    assert.equal(await run(["logincheck"], envLogin), 0);
    assert.equal(cli.mt.last().headers?.["username"], "envuser123");
    assert.equal(cli.mt.last().headers?.["password"], "envpass123");
  } finally {
    cli.cleanup();
  }
});

test("half a login from the variables is not completed from the file", async () => {
  const cli = makeCli({ env: { DESTATIS_USERNAME: "envuser123" } });
  try {
    cli.store.set("password", PASSWORD);
    cli.store.set("token", TOKEN);
    assert.equal(await run(["logincheck"], cli.deps), 2);
    assert.equal(cli.mt.calls.length, 0);
    const err = untimed(cli.err.join("\n"));
    assert.match(err, /^ERROR \[destatis\.cli\] Provide BOTH --username and --password \(or use --token\)\. Env: DESTATIS_USERNAME \+ DESTATIS_PASSWORD, or DESTATIS_API_TOKEN\.$/m);
    assert.ok(!err.includes(PASSWORD) && !err.includes(TOKEN));
  } finally {
    cli.cleanup();
  }
});

test("the file's own login follows the same rules: a token with a login, or half a pair, is a usage error", async () => {
  const cli = makeCli();
  try {
    cli.store.set("token", TOKEN);
    cli.store.set("username", USERNAME);
    assert.equal(await run(["logincheck"], cli.deps), 2);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /A token cannot be combined with a username\/password \(set: the stored token, the stored username\)\..*destatis config unset/);
    cli.err.length = 0;
    cli.store.unset("token");
    assert.equal(await run(["logincheck"], cli.deps), 2);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /Provide BOTH --username and --password.*The credentials file holds no password: `destatis config set password` stores it\./);
    assert.ok(!cli.err.join("\n").includes(USERNAME));
  } finally {
    cli.cleanup();
  }
});

test("a credential read from the file is redacted when the server echoes it back", async () => {
  const cli = makeCli({ responder: () => jsonResponse({ ...fx.loginOk, Username: TOKEN }) });
  try {
    cli.store.set("token", TOKEN);
    assert.equal(await run(["logincheck"], cli.deps), 0);
    assert.ok(!cli.out.join("\n").includes(TOKEN), cli.out.join("\n"));
    assert.match(cli.out.join("\n"), /"Username": "\*\*\*"/);
  } finally {
    cli.cleanup();
  }
});

test("a credentials file others can read is refused, and only when it is needed", async () => {
  const cli = makeCli();
  try {
    cli.store.set("token", TOKEN);
    chmodSync(cli.store.path, 0o644);
    assert.equal(await run(["logincheck"], cli.deps), 1);
    assert.match(cli.err.join("\n"), /can be read by others \(mode 644\).*chmod 600/);
    assert.equal(cli.mt.calls.length, 0);
    // A login given another way, --guest and hello do not read the file at all.
    assert.equal(await run(["--token", TOKEN, "logincheck"], cli.deps), 0);
    assert.equal(await run(["logincheck"], { ...cli.deps, env: { DESTATIS_API_TOKEN: TOKEN } }), 0);
    assert.equal(await run(["--guest", "find", "x"], cli.deps), 0);
    assert.equal(await run(["hello"], cli.deps), 0);
  } finally {
    cli.cleanup();
  }
});

test("--guest ignores a stored login rather than refusing it", async () => {
  const cli = makeCli({ responder: () => jsonResponse(fx.findResult) });
  try {
    cli.store.set("token", TOKEN);
    assert.equal(await run(["--guest", "find", "x"], cli.deps), 0, cli.err.join("\n"));
    assert.notEqual(cli.mt.last().headers?.["username"], TOKEN);
  } finally {
    cli.cleanup();
  }
});

test("deps without a credentials store never read a credentials file", async () => {
  const cli = makeCli({ credentials: false, env: { XDG_CONFIG_HOME: "/nonexistent" } });
  try {
    assert.equal(await run(["logincheck"], cli.deps), 2);
    assert.match(cli.err.join("\n"), /No credentials\./);
    assert.equal(cli.mt.calls.length, 0);
    assert.equal(await run(["config", "list"], cli.deps), 1);
    assert.match(cli.err.join("\n"), /built without a credentials file/);
  } finally {
    cli.cleanup();
  }
});

test("the messages that ask for credentials name destatis config set", async () => {
  const cli = makeCli({ responder: () => jsonResponse(fx.flatNotAuthorized, 401) });
  try {
    assert.equal(await run(["--guest", "find", "x"], cli.deps), 1);
    assert.match(untimed(cli.err.join("\n")), /^INFO  \[destatis\.api\] GENESIS refused the request without credentials\..*`destatis config set token`/m);
    cli.err.length = 0;
    cli.store.set("token", TOKEN);
    assert.equal(await run(["logincheck"], cli.deps), 1);
    assert.match(untimed(cli.err.join("\n")), /^INFO  \[destatis\.api\] check your credentials .*`destatis config list`/m);
  } finally {
    cli.cleanup();
  }
});

test("the credentials file: where it is, what it refuses, and how it masks", () => {
  assert.equal(resolveCredentialsPath({ XDG_CONFIG_HOME: "/x" }), "/x/destatis-genesis/credentials");
  assert.equal(resolveCredentialsPath({ XDG_CONFIG_HOME: "relative", HOME: "/home/me" }), "/home/me/.config/destatis-genesis/credentials");
  assert.equal(resolveCredentialsPath({ XDG_CONFIG_HOME: "  ", HOME: "/home/me" }), "/home/me/.config/destatis-genesis/credentials");
  assert.equal(maskCredential("short"), "****");
  assert.equal(maskCredential(TOKEN), "0123…cdef");
  assert.equal(credentialValueProblem("with spaces inside"), undefined);
  assert.match(credentialValueProblem("a\r\nb") ?? "", /line break/);
  const dir = mkdtempSync(join(tmpdir(), "destatis-store-"));
  try {
    const path = join(dir, "credentials");
    writeFileSync(path, "{ not json", { mode: 0o600 });
    assert.throws(() => new CredentialStore(path).get("token"), /not valid JSON/);
    writeFileSync(path, JSON.stringify({ token: 5 }), { mode: 0o600 });
    assert.throws(() => new CredentialStore(path).get("token"), /not an object of names and strings/);
    writeFileSync(path, JSON.stringify(["token"]), { mode: 0o600 });
    assert.throws(() => new CredentialStore(path).get("token"), /not an object of names and strings/);
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "credentials"), JSON.stringify({ token: TOKEN }), { mode: 0o600 });
    symlinkSync(join(dir, "real", "credentials"), join(dir, "link"));
    assert.throws(() => new CredentialStore(join(dir, "link")).get("token"), /not a regular file/);
    const store = new CredentialStore(join(dir, "fresh", "credentials"));
    store.set("token", TOKEN);
    store.set("password", PASSWORD);
    assert.deepEqual(JSON.parse(readFileSync(store.path, "utf8")), { password: PASSWORD, token: TOKEN });
    assert.throws(() => store.set("API TOKEN", TOKEN), /Not a credential name/);
    assert.throws(() => store.set("token", " \n"), /empty/);
    // The last unset removes the file.
    store.unset("token");
    store.unset("password");
    assert.throws(() => statSync(store.path), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stored value the library would refuse fails the run with exit 1, naming the credential, not its value", async () => {
  const cli = makeCli();
  try {
    mkdirSync(join(cli.dir, "destatis-genesis"), { mode: 0o700 });
    writeFileSync(cli.store.path, JSON.stringify({ token: ` ${TOKEN}` }), { mode: 0o600 });
    assert.equal(await run(["logincheck"], cli.deps), 1);
    const err = cli.err.join("\n");
    assert.match(err, /The token stored in .* cannot be sent: .*destatis config set token/);
    assert.ok(!err.includes(TOKEN));
    assert.equal(cli.mt.calls.length, 0);
  } finally {
    cli.cleanup();
  }
});

test("a secret piped in is read whole, one trailing newline dropped", async () => {
  assert.equal(await readSecretFrom(Readable.from([`${PASSWORD}\n`]), { write: () => true }, "password: "), PASSWORD);
  assert.equal(await readSecretFrom(Readable.from([TOKEN.slice(0, 16), `${TOKEN.slice(16)}\r\n`]), { write: () => true }, "token: "), TOKEN);
});

test("maskCredential: a value shows its ends only from 20 characters, a password never (C7)", () => {
  assert.equal(maskCredential("Sommer2026!x"), "****");
  assert.equal(maskCredential("a".repeat(19)), "****");
  assert.equal(maskCredential("abcd0123456789abwxyz"), "abcd…wxyz");
  assert.equal(maskCredential(TOKEN, "token"), "0123…cdef");
  assert.equal(maskCredential("a-very-long-password-of-40-characters!!!", "password"), "****");
});

test("a stored password is never partly shown: not by set, get or list (C7)", async () => {
  for (const secret of ["Sommer2026!x", "a-very-long-password-of-40-characters!!!"]) {
    const cli = makeCli({ secret });
    try {
      assert.equal(await run(["config", "set", "password"], cli.deps), 0, cli.err.join("\n"));
      assert.match(cli.err.join("\n"), /Stored password \(\*\*\*\*\) in /);
      assert.equal(await run(["config", "get", "password"], cli.deps), 0);
      assert.equal(await run(["config", "list"], cli.deps), 0);
      assert.deepEqual(cli.out, ["****", "password  ****"]);
      const all = cli.out.join("\n") + cli.err.join("\n");
      assert.ok(!all.includes(secret.slice(0, 4)) && !all.includes(secret.slice(-4)), all);
    } finally {
      cli.cleanup();
    }
  }
});
