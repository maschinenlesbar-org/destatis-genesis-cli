import { test } from "node:test";
import assert from "node:assert/strict";
import { redactionFor, run } from "../src/cli/run.js";
import { renderJson } from "../src/cli/shared.js";
import { DestatisClient } from "@maschinenlesbar.org/destatis-genesis-client/internal/client";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/destatis-genesis-client/internal/http";
import { makeMockTransport, jsonResponse, rawResponse, bodyOf, untimed } from "./helpers.js";
import * as fx from "@maschinenlesbar.org/destatis-genesis-client/test/fixtures";
import { credentialsIn } from "@maschinenlesbar.org/destatis-genesis-client/internal/errors";

function makeCli(
  responder: (req: HttpRequest) => HttpResponse,
  env: Record<string, string | undefined> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, Buffer>();
  const mt = makeMockTransport(responder);

  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: (p, d) => files.set(p, d),
      fileState: (p) => (files.has(p) ? "exists" : "absent"),
      outBinary: (d) => out.push(d.toString("utf8")),
    },
    createClient: (opts) => new DestatisClient({ ...opts, transport: mt.transport }),
    env,
  };
  return { deps, out, err, files, mt };
}

const TOKEN = ["--token", "0123456789abcdef0123456789abcdef"];

test("hello works without credentials and hits whoami", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["hello"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/genesisWS/rest/2020/helloworld/whoami");
  assert.deepEqual(JSON.parse(cli.out.join("\n")), fx.whoami);
});

test("a command without credentials and without --guest exits 2, naming both ways, and issues no request", async () => {
  for (const argv of [["catalogue", "tables", "124"], ["find", "Bevölkerung"], ["logincheck"]]) {
    for (const env of [{}, { DESTATIS_API_TOKEN: "  " }]) {
      const cli = makeCli(() => jsonResponse(fx.tablesList), env);
      const code = await run(argv, cli.deps);
      assert.equal(code, 2, argv.join(" "));
      assert.equal(cli.mt.calls.length, 0);
      assert.match(
        untimed(cli.err.join("\n")),
        /^ERROR \[destatis\.cli\] No credentials\. Set --token \(env DESTATIS_API_TOKEN\) or --username\/--password \(env DESTATIS_USERNAME \/ DESTATIS_PASSWORD\), store them once with `destatis config set token` \(or `username` and `password`\), or pass --guest/,
      );
    }
  }
});

test("--guest on an account-only command exits 2 before any request", async () => {
  for (const argv of [["catalogue", "tables", "124"], ["logincheck"], ["metadata", "table", "12411-0001"], ["data", "tablefile", "12411-0001"]]) {
    const cli = makeCli(() => jsonResponse(fx.tablesList));
    const code = await run(["--base-url", "http://mirror.example", "--guest", ...argv], cli.deps);
    assert.equal(code, 2, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(untimed(cli.err.join("\n")), new RegExp(`^ERROR \\[destatis\\.cli\\] \`${argv.slice(0, 2).join(" ").replace(/ 124$| 12411-0001$/, "")}\` needs an account; --guest covers \`find\` only`, "m"));
    // A usage error: no http warning either.
    assert.doesNotMatch(untimed(cli.err.join("\n")), /^WARN /m);
  }
});

test("--guest with any credential (flag or variable) exits 2 naming them, never their values", async () => {
  for (const [argv, env, named] of [
    [["--token", "0123456789abcdef0123456789abcdef"], {}, "--token"],
    [["--username", "flaguser", "--password", "flagpass"], {}, "--username, --password"],
    [[], { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" }, "DESTATIS_API_TOKEN"],
    [[], { DESTATIS_PASSWORD: "envpass1" }, "DESTATIS_PASSWORD"],
    // A malformed variable is a credential too: no fallback to guest.
    [[], { DESTATIS_API_TOKEN: " bad-token " }, "DESTATIS_API_TOKEN"],
  ] as const) {
    for (const command of [["find", "Bev"], ["hello"]]) {
      const cli = makeCli(() => jsonResponse(fx.findResult), { ...env });
      const code = await run(["--guest", ...argv, ...command], cli.deps);
      assert.equal(code, 2, `${argv.join(" ")} ${JSON.stringify(env)} ${command[0]}`);
      assert.equal(cli.mt.calls.length, 0);
      const err = cli.err.join("\n");
      assert.ok(err.includes(`--guest cannot be combined with credentials (${named} set)`), err);
      assert.doesNotMatch(err, /0123456789abcdef|flagpass|envpass1|bad-token/);
    }
  }
});

test("a malformed credential variable still fails find without --guest (no fallback to guest)", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult), { DESTATIS_API_TOKEN: " bad-token " });
  const code = await run(["find", "Bev"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Environment variable DESTATIS_API_TOKEN has leading or trailing whitespace/);
});

test("--guest find runs as the GENESIS guest user and sends no credential header", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult));
  const code = await run(["--guest", "find", "Bevölkerung", "--category", "tables"], cli.deps);
  assert.equal(code, 0);
  const req = cli.mt.last();
  assert.equal(new URL(req.url).pathname, "/genesisWS/rest/2020/find/find");
  assert.equal(req.headers?.["username"], undefined);
  assert.equal(req.headers?.["password"], undefined);
  assert.equal(bodyOf(req).get("term"), "Bevölkerung");
});

test("only one of --username/--password exits 2 before any request", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run(["catalogue", "tables", "--username", "USER123456"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /BOTH --username and --password/);
});

test("--token sends the token in the username header", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "catalogue", "tables", "124*"], cli.deps);
  assert.equal(code, 0);
  const req = cli.mt.last();
  assert.equal(req.headers?.["username"], "0123456789abcdef0123456789abcdef");
  assert.equal(req.headers?.["password"], undefined);
  assert.equal(bodyOf(req).get("selection"), "124*");
});

test("a credential passed via --token warns to stderr, recommending the env var (GEN-01)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "catalogue", "tables", "124*"], cli.deps);
  assert.equal(code, 0);
  const errText = cli.err.join("\n");
  assert.match(untimed(errText), /^WARN  \[destatis\.cli\] credential\(s\) passed on the command line are visible in the process list/m);
  assert.match(errText, /DESTATIS_API_TOKEN/);
  // The credential value itself is never printed.
  assert.doesNotMatch(errText, /0123456789abcdef/);
});

test("a credential from the environment does NOT trigger the argv warning (GEN-01)", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult), {
    DESTATIS_API_TOKEN: "envtoken0000000000000000000000ab",
  });
  const code = await run(["find", "Bevölkerung"], cli.deps);
  assert.equal(code, 0);
  assert.doesNotMatch(cli.err.join("\n"), /visible in the process list/);
});

test("DESTATIS_API_TOKEN from the environment seeds the credential", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult), {
    DESTATIS_API_TOKEN: "envtoken0000000000000000000000ab",
  });
  const code = await run(["find", "Bevölkerung"], cli.deps);
  assert.equal(code, 0);
  const req = cli.mt.last();
  assert.equal(req.headers?.["username"], "envtoken0000000000000000000000ab");
  assert.equal(bodyOf(req).get("term"), "Bevölkerung");
  assert.equal(new URL(req.url).pathname, "/genesisWS/rest/2020/find/find");
});

test("an explicit --token overrides DESTATIS_API_TOKEN from the environment", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult), { DESTATIS_API_TOKEN: "envtoken" });
  await run([...TOKEN, "find", "x"], cli.deps);
  assert.equal(cli.mt.last().headers?.["username"], "0123456789abcdef0123456789abcdef");
});

test("a token together with a username or password, from any source, is a usage error naming the sources", async () => {
  const T = "0123456789abcdef0123456789abcdef";
  for (const [argv, env, named] of [
    [[...TOKEN, "--username", "flaguser", "--password", "flagpass"], {}, "--token, --username, --password"],
    [[...TOKEN, "--username", "flaguser"], {}, "--token, --username"],
    [[...TOKEN, "--password", "flagpass"], {}, "--token, --password"],
    [["--username", "flaguser", "--password", "flagpass"], { DESTATIS_API_TOKEN: T }, "DESTATIS_API_TOKEN, --username, --password"],
    [["--username", "flaguser"], { DESTATIS_API_TOKEN: T }, "DESTATIS_API_TOKEN, --username"],
    [["--password", "flagpass"], { DESTATIS_API_TOKEN: T, DESTATIS_USERNAME: "envuser" }, "DESTATIS_API_TOKEN, DESTATIS_USERNAME, --password"],
    [[...TOKEN], { DESTATIS_USERNAME: "envuser", DESTATIS_PASSWORD: "envpass1" }, "--token, DESTATIS_USERNAME, DESTATIS_PASSWORD"],
    [[], { DESTATIS_API_TOKEN: T, DESTATIS_USERNAME: "envuser", DESTATIS_PASSWORD: "envpass1" }, "DESTATIS_API_TOKEN, DESTATIS_USERNAME, DESTATIS_PASSWORD"],
    [[], { DESTATIS_API_TOKEN: T, DESTATIS_PASSWORD: "envpass1" }, "DESTATIS_API_TOKEN, DESTATIS_PASSWORD"],
  ] as const) {
    const cli = makeCli(() => jsonResponse(fx.loginOk), { ...env });
    const code = await run([...argv, "logincheck"], cli.deps);
    const label = `${argv.join(" ")} ${JSON.stringify(env)}`;
    assert.equal(code, 2, label);
    assert.equal(cli.mt.calls.length, 0, label);
    const err = untimed(cli.err.join("\n"));
    assert.ok(err.includes(`ERROR [destatis.cli] A token cannot be combined with a username/password (set: ${named}).`), `${label}\n${err}`);
    assert.doesNotMatch(err, /flagpass|envpass1|0123456789abcdef/);
  }
});

test("a blank DESTATIS_API_TOKEN is unset, so it doesn't conflict with a login", async () => {
  const cli = makeCli(() => jsonResponse(fx.loginOk), { DESTATIS_API_TOKEN: "  ", DESTATIS_USERNAME: "envuser", DESTATIS_PASSWORD: "envpass" });
  assert.equal(await run(["logincheck"], cli.deps), 0, cli.err.join("\n"));
  assert.equal(cli.mt.last().headers?.["username"], "envuser");
  assert.equal(cli.mt.last().headers?.["password"], "envpass");
});

test("a --password flag combines with DESTATIS_USERNAME (flag wins per field)", async () => {
  const cli = makeCli(() => jsonResponse(fx.loginOk), { DESTATIS_USERNAME: "envuser", DESTATIS_PASSWORD: "envpass" });
  const code = await run(["--password", "flagpass", "logincheck"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.last().headers?.["username"], "envuser");
  assert.equal(cli.mt.last().headers?.["password"], "flagpass");
});

test("a --username flag combines with DESTATIS_PASSWORD (flag wins per field)", async () => {
  const cli = makeCli(() => jsonResponse(fx.loginOk), { DESTATIS_USERNAME: "envuser", DESTATIS_PASSWORD: "envpass" });
  const code = await run(["--username", "flaguser", "logincheck"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.last().headers?.["username"], "flaguser");
  assert.equal(cli.mt.last().headers?.["password"], "envpass");
});

test("a control character in --user-agent is rejected before any request", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["hello", "--user-agent", "bad\r\nX-Injected: 1"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /control character/i);
});

test("a control character in a credential (--token) is rejected before any request", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run(["--token", "tok\r\nX-Injected: 1", "catalogue", "tables"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("a control character in an env credential is rejected before any request (GEN-06)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList), {
    DESTATIS_API_TOKEN: `tok${String.fromCharCode(0x0d)}${String.fromCharCode(0x0a)}X-Injected: 1`,
  });
  const code = await run(["catalogue", "tables", "124"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /DESTATIS_API_TOKEN contains control characters/);
});

test("non-Latin-1 characters in --user-agent, --token or an env password are usage errors", async () => {
  for (const [argv, env, pattern] of [
    [["--user-agent", "ü€", "hello"], {}, /outside Latin-1/],
    [["--token", "tok\u{1F600}", "find", "x"], {}, /outside Latin-1/],
    [
      ["logincheck"],
      { DESTATIS_USERNAME: "testuser", DESTATIS_PASSWORD: "s3cr3t€pw" },
      /Environment variable DESTATIS_PASSWORD contains characters outside Latin-1/,
    ],
  ] as const) {
    const cli = makeCli(() => jsonResponse(fx.loginOk), { ...env });
    const code = await run([...argv], cli.deps);
    assert.equal(code, 2, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), pattern);
    assert.doesNotMatch(cli.err.join("\n"), /Unexpected error|s3cr3t/);
  }
});

test("a Latin-1 --user-agent (ü) is accepted and sent", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["--user-agent", "Grüße-cli", "hello"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.last().headers?.["User-Agent"], "Grüße-cli");
});

test("a blank --token/--username/--password/--user-agent is a usage error, not a silent unset", async () => {
  for (const argv of [
    ["--token", "", "find", "x"],
    ["--token", "  ", "logincheck"],
    ["--username", "", "--password", "p", "logincheck"],
    ["--user-agent", "", "hello"],
  ]) {
    const cli = makeCli(() => jsonResponse(fx.findResult), { DESTATIS_API_TOKEN: "goodtoken" });
    const code = await run(argv, cli.deps);
    assert.equal(code, 2, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /Expected a non-empty value/);
  }
});

test("a credential with surrounding whitespace is rejected, not silently trimmed", async () => {
  const flag = makeCli(() => jsonResponse(fx.loginOk));
  assert.equal(await run(["--username", "u", "--password", " p ", "logincheck"], flag.deps), 2);
  assert.equal(flag.mt.calls.length, 0);
  assert.match(flag.err.join("\n"), /--password <pass>' is invalid: Value has leading or trailing whitespace/);
  assert.doesNotMatch(flag.err.join("\n"), / p /);

  const env = makeCli(() => jsonResponse(fx.loginOk), {
    DESTATIS_USERNAME: "testuser",
    DESTATIS_PASSWORD: "  pass with spaces  ",
  });
  assert.equal(await run(["logincheck"], env.deps), 2);
  assert.equal(env.mt.calls.length, 0);
  assert.match(
    env.err.join("\n"),
    /Environment variable DESTATIS_PASSWORD has leading or trailing whitespace/,
  );
  assert.doesNotMatch(env.err.join("\n"), /pass with spaces/);
});

test("inner spaces in a credential are sent as given", async () => {
  const cli = makeCli(() => jsonResponse(fx.loginOk), { DESTATIS_USERNAME: "u", DESTATIS_PASSWORD: "pass with spaces" });
  assert.equal(await run(["logincheck"], cli.deps), 0);
  assert.equal(cli.mt.last().headers?.["password"], "pass with spaces");
});

test("a blank <term> on find is rejected before any request", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult));
  const code = await run([...TOKEN, "find", "   "], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("--pagelength above the server cap (25000) is rejected client-side", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "--pagelength", "25001", "catalogue", "tables"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("--max-retries above the sane maximum is rejected client-side", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "--max-retries", "1000000", "catalogue", "tables"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("data table sends the object name to data/table", async () => {
  const cli = makeCli(() => jsonResponse(fx.dataTable));
  const code = await run([...TOKEN, "data", "table", "12411-0001", "--start-year", "2020"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/genesisWS/rest/2020/data/table");
  const body = bodyOf(cli.mt.last());
  assert.equal(body.get("name"), "12411-0001");
  assert.equal(body.get("startyear"), "2020");
});

test("a GENESIS logical error (HTTP 200 + Status Fehler) exits 1", async () => {
  const cli = makeCli(() => jsonResponse(fx.genericError));
  const code = await run([...TOKEN, "data", "table", "12411-0001"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /GENESIS status -1/);
});

test("a not-found (Status.Code 90) exits 4", async () => {
  const cli = makeCli(() => jsonResponse(fx.notFound));
  const code = await run([...TOKEN, "metadata", "table", "99999-9999"], cli.deps);
  assert.equal(code, 4);
});

test("the live 401 + flat Code 15 reply exits 1 with the GENESIS text and a credentials hint", async () => {
  const cli = makeCli(() => jsonResponse(fx.flatNotAuthorized, 401));
  const code = await run([...TOKEN, "catalogue", "tables", "12411*"], cli.deps);
  assert.equal(code, 1);
  const errText = cli.err.join("\n");
  assert.match(errText, /GENESIS status 15/);
  assert.match(errText, /nicht berechtigt/);
  assert.match(untimed(errText), /^INFO  \[destatis\.api\] check your credentials/m);
});

test("the live 404 + flat Code 2 reply (wrong credentials) exits 1, not 4, with text and hint", async () => {
  const cli = makeCli(() => jsonResponse(fx.flatBadCredentials, 404));
  const code = await run([...TOKEN, "metadata", "table", "12411-0001"], cli.deps);
  assert.equal(code, 1);
  const errText = cli.err.join("\n");
  assert.match(errText, /GENESIS status 2 \(ERROR\) \/ HTTP 404/);
  assert.match(errText, /Nutzernamen/);
  assert.match(untimed(errText), /^INFO  \[destatis\.api\] check your credentials/m);
});

test("hello (no credentials sent) gets no credentials hint on a 401/403", async () => {
  for (const status of [401, 403]) {
    const cli = makeCli(() => rawResponse("", "text/html", status));
    const code = await run(["hello"], cli.deps);
    assert.equal(code, 1);
    assert.match(cli.err.join("\n"), new RegExp(`HTTP ${status} for GET`));
    assert.doesNotMatch(cli.err.join("\n"), /Hint/);
  }
});

test("a guest find refused with 401 + Code 15 hints that credentials are needed", async () => {
  const cli = makeCli(() => jsonResponse(fx.flatNotAuthorized, 401));
  const code = await run(["--guest", "find", "x"], cli.deps);
  assert.equal(code, 1);
  const errText = cli.err.join("\n");
  assert.match(untimed(errText), /^INFO  \[destatis\.api\] GENESIS refused the request without credentials\. Set --token/m);
  assert.doesNotMatch(errText, /check your credentials/);
});

test("a bare HTTP 404 still exits 4", async () => {
  const cli = makeCli(() => jsonResponse({ detail: "nope" }, 404));
  const code = await run([...TOKEN, "metadata", "table", "12411-0001"], cli.deps);
  assert.equal(code, 4);
  assert.doesNotMatch(cli.err.join("\n"), /Hint/);
});

test("data tablefile with a Status.Code 104 reply (unknown code) exits 4 and writes no file", async () => {
  const cli = makeCli(() => jsonResponse(fx.emptyResult));
  const code = await run([...TOKEN, "data", "tablefile", "99999-9999", "--format", "xlsx", "-o", "t.xlsx"], cli.deps);
  assert.equal(code, 4);
  assert.equal(cli.files.size, 0);
  assert.match(cli.err.join("\n"), /GENESIS status 104/);
  assert.doesNotMatch(cli.err.join("\n"), /Wrote/);
});

test("data cubefile with a 200 HTML page instead of the file exits 1 and writes no file (03#1)", async () => {
  const page = "<!DOCTYPE html><html><body>Wartungsarbeiten</body></html>";
  for (const [body, type] of [[page, "text/html"], [page, "application/octet-stream"], [`\uFEFF  <html>${page}`, ""]] as const) {
    const cli = makeCli(() => rawResponse(body, type), { DESTATIS_API_TOKEN: "TOK" });
    const code = await run(["data", "cubefile", "12411BJ001", "-o", "data.zip"], cli.deps);
    assert.equal(code, 1, `${type}: ${cli.err.join("\n")}`);
    assert.equal(cli.files.size, 0);
    assert.match(cli.err.join("\n"), /got an HTML page/);
  }
});

test("data tablefile writes a ZIP whatever its Content-Type, and HTML when --format html asked for it", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const asZip = makeCli(() => rawResponse(zip, "text/html"), { DESTATIS_API_TOKEN: "TOK" });
  assert.equal(await run(["data", "tablefile", "12411-0001", "-o", "t.zip"], asZip.deps), 0, asZip.err.join("\n"));
  assert.equal(asZip.files.size, 1);
  const html = makeCli(() => rawResponse("<html>table</html>", "text/html"), { DESTATIS_API_TOKEN: "TOK" });
  assert.equal(await run(["data", "tablefile", "12411-0001", "--format", "html", "-o", "t.html"], html.deps), 0, html.err.join("\n"));
});

test("data tablefile with an empty body exits 1 and writes no file", async () => {
  const cli = makeCli(() => ({ status: 200, headers: { "content-type": "application/zip" }, body: Buffer.alloc(0) }));
  const code = await run([...TOKEN, "data", "tablefile", "12411-0001", "-o", "t.zip"], cli.deps);
  assert.equal(code, 1);
  assert.equal(cli.files.size, 0);
  assert.match(cli.err.join("\n"), /\/data\/tablefile: empty response body; expected a file download\./);
});

test("--output writes JSON to a file and keeps stdout clean", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "--output", "/tmp/out.json", "catalogue", "tables"], cli.deps);
  assert.equal(code, 0);
  assert.match(cli.files.get("/tmp/out.json")?.toString("utf8") ?? "", /12411-0001/);
  assert.equal(cli.out.length, 0);
  assert.match(untimed(cli.err.join("\n")), /^INFO  \[destatis\.output\] Wrote \d+ bytes to \/tmp\/out\.json/m);
});

test("--output refuses to overwrite an existing file without --force (GEN-04)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  cli.files.set("/tmp/out.json", Buffer.from("existing"));
  const code = await run([...TOKEN, "--output", "/tmp/out.json", "catalogue", "tables"], cli.deps);
  assert.equal(code, 2);
  // The pre-existing file is untouched, and nothing was written to stdout.
  assert.equal(cli.files.get("/tmp/out.json")?.toString("utf8"), "existing");
  assert.equal(cli.out.length, 0);
  assert.match(cli.err.join("\n"), /Refusing to overwrite/);
});

test("--force allows overwriting an existing --output file (GEN-04)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  cli.files.set("/tmp/out.json", Buffer.from("existing"));
  const code = await run([...TOKEN, "--force", "--output", "/tmp/out.json", "catalogue", "tables"], cli.deps);
  assert.equal(code, 0);
  assert.match(cli.files.get("/tmp/out.json")?.toString("utf8") ?? "", /12411-0001/);
});

test("a filesystem write error surfaces as a typed output error (exit 1), not Unexpected (GEN-04, K7)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  cli.deps.io.writeFile = () => {
    throw new Error("EACCES: permission denied, open '/root/out.json'");
  };
  const code = await run([...TOKEN, "--output", "/root/out.json", "catalogue", "tables"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /Could not write to .*EACCES/);
  assert.doesNotMatch(cli.err.join("\n"), /Unexpected error/);
});

test("a file that appears between the check and the write (EEXIST) is refused like an existing one, exit 1 (K7)", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  let overwriteFlag: boolean | undefined;
  cli.deps.io.writeFile = (_p, _d, overwrite) => {
    overwriteFlag = overwrite;
    throw Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" });
  };
  const code = await run([...TOKEN, "-o", "race.json", "catalogue", "tables"], cli.deps);
  assert.equal(code, 1);
  assert.equal(overwriteFlag, false);
  assert.match(cli.err.join("\n"), /Refusing to overwrite existing file "race.json"/);
});

test("--force writes with overwrite allowed", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  let overwriteFlag: boolean | undefined;
  cli.deps.io.writeFile = (_p, _d, overwrite) => {
    overwriteFlag = overwrite;
  };
  assert.equal(await run([...TOKEN, "--force", "-o", "x.json", "catalogue", "tables"], cli.deps), 0);
  assert.equal(overwriteFlag, true);
});

test("an empty --output is rejected instead of silently writing to stdout", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["hello", "--output", ""], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
  assert.equal(cli.out.length, 0);
});

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const served = { ...fx.whoami, "User-Agent": `destatis${controls}`, "User-IP": String.fromCharCode(0x1b) + "[31m" };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "hello"], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) => c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f);
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /destatis\\u007f\\u0085\\u009b2J/);
    assert.deepEqual(JSON.parse(text), served);
  }
});

test("bidi formatting characters in server data are escaped in the JSON output", async () => {
  const bidi = String.fromCharCode(0x202e, 0x2066, 0x200f, 0x061c);
  const served = { ...fx.whoami, "User-Agent": `A1${bidi}live` };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "hello"], cli.deps), 0);
    const text = cli.out.join("\n");
    assert.ok(!/[\u202e\u2066\u200f\u061c]/.test(text), format.join(" "));
    assert.match(text, /A1\\u202e\\u2066\\u200f\\u061clive/);
    assert.deepEqual(JSON.parse(text), served);
  }
});

test("an answer nested too deeply is a clean error; it suggests --compact only where --compact prints it (D7)", async () => {
  // A hostile or broken answer: JSON.parse reads it, the pretty printer's recursion can't. Whether
  // the compact printer can depends on the Node version (iterative from Node 26) and the stack:
  // probed here, never assumed.
  const depth = 200_000;
  // A valid find envelope whose `Tables` list nests very deeply.
  const text = '{"Status":{"Code":0,"Content":"ok","Type":"Information"},"Tables":' + "[".repeat(depth) + "]".repeat(depth) + "}";
  let compactPrints = true;
  try {
    JSON.stringify(JSON.parse(text));
  } catch {
    compactPrints = false;
  }
  const deep = () => rawResponse(text, "application/json");
  const pretty = makeCli(deep);
  assert.equal(await run(["--guest", "find", "x"], pretty.deps), 1);
  assert.deepEqual(pretty.out, []);
  assert.equal(
    untimed(pretty.err.join("\n")),
    `ERROR [destatis.output] The answer is nested too deeply to pretty-print${compactPrints ? "; try --compact" : ""}.`,
  );
  const compact = makeCli(deep);
  assert.equal(await run(["--guest", "--compact", "find", "x"], compact.deps), compactPrints ? 0 : 1);
  if (compactPrints) assert.equal(compact.out.join("").length, text.length);
  else assert.equal(untimed(compact.err.join("\n")), "ERROR [destatis.output] The answer is nested too deeply to print.");
});

test("an answer too large to print is called too large, not too deep; the hint only where --compact prints (D7)", (t) => {
  const { deps } = makeCli(() => jsonResponse(fx.whoami));
  const real = JSON.stringify;
  // V8's own error for a text past its longest string, stood in for: a real one needs 512 MB.
  const tooLarge = (gap: unknown): boolean => gap === 2 || gap === "big";
  t.mock.method(JSON, "stringify", (value: unknown, replacer: never, gap: unknown) => {
    if (tooLarge(gap) || (gap === undefined && (value as { all?: boolean }).all === true)) throw new RangeError("Invalid string length");
    return real(value, replacer, gap as number);
  });
  assert.throws(() => renderJson(deps, {}, { Code: 0 }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to pretty-print; try --compact\.$/.test(err.message));
  assert.throws(() => renderJson(deps, {}, { all: true }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to pretty-print\.$/.test(err.message));
  assert.throws(() => renderJson(deps, { compact: true }, { all: true }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to print\.$/.test(err.message));
});

test("--compact takes the gap path only for an answer holding a huge string, the fast path otherwise", (t) => {
  // On Node 26 V8's fast path (no gap) aborts the process on a ~250 MB string from JSON.parse; its
  // gap path (an empty gap, the same text) prints it. Only the fast path is iterative there, though,
  // and prints nesting the gap path refuses at ~7,000 levels. So the path is chosen per answer.
  // Too big a body for this suite: this pins the calls.
  const { deps, out } = makeCli(() => jsonResponse(fx.whoami));
  const stringify = t.mock.method(JSON, "stringify", () => '"stub"');
  const huge = "x".repeat(64 * 1024 * 1024);
  renderJson(deps, { compact: true }, { Object: { Content: huge } });
  renderJson(deps, { compact: true }, { Object: { Content: huge.slice(1) }, x: [[["Tabelle"]]] });
  renderJson(deps, { compact: true }, { [huge]: 1 });
  renderJson(deps, { compact: true }, [[huge]]);
  renderJson(deps, {}, { Code: 0 });
  const calls = stringify.mock.calls.map((call) => call.arguments);
  stringify.mock.restore();
  assert.deepEqual(calls.map((args) => (args.length >= 3 ? args[2] : "none")), ["", "none", "", "", 2]);
  assert.deepEqual(out, ['"stub"', '"stub"', '"stub"', '"stub"', '"stub"']);
});

test("terminal controls are escaped in chunks: the same text as one pass, across chunk edges (D7)", () => {
  const DEL = String.fromCharCode(0x7f);
  const C1 = String.fromCharCode(0x9b);
  const RLO = String.fromCharCode(0x202e);
  // Controls right before, at and after the 64 Ki edges, and a run of them.
  const text = ["a".repeat(65535), DEL, C1, "b".repeat(65534), RLO, DEL.repeat(70000), "ü😀", C1].join("");
  const { deps, out } = makeCli(() => jsonResponse(fx.whoami));
  renderJson(deps, { compact: true }, { text });
  const expected = JSON.stringify({ text }).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  assert.equal(out[0], expected);
  assert.deepEqual(JSON.parse(out[0]!), { text });
});

test("an empty 200 reply exits 1 instead of printing null", async () => {
  const cli = makeCli(() => rawResponse("", "application/json"));
  const code = await run(["--guest", "find", "x"], cli.deps);
  assert.equal(code, 1);
  assert.deepEqual(cli.out, []);
  assert.match(cli.err.join("\n"), /POST https:\/\/genesis\.destatis\.de\/genesisWS\/rest\/2020\/find\/find: empty response body\./);
});

test("--compact prints single-line JSON", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  await run([...TOKEN, "--compact", "catalogue", "tables"], cli.deps);
  assert.equal(cli.out.length, 1);
  assert.equal(cli.out[0], JSON.stringify(fx.tablesList));
});

test("logincheck requires credentials", async () => {
  const cli = makeCli(() => jsonResponse(fx.loginOk));
  const code = await run(["logincheck"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("--timeout accepts up to the largest timer Node supports", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  assert.equal(await run(["--timeout", "2147483647", "hello"], cli.deps), 0);
  assert.equal(cli.mt.last().timeoutMs, 2_147_483_647);

  const over = makeCli(() => jsonResponse(fx.whoami));
  assert.equal(await run(["--timeout", "2147483648", "hello"], over.deps), 2);
  assert.equal(over.mt.calls.length, 0);
  assert.match(over.err.join("\n"), /Must be <= 2147483647/);
});

test("--help exits 0", async () => {
  const cli = makeCli(() => jsonResponse({}));
  assert.equal(await run(["--help"], cli.deps), 0);
});

test("a commander usage error (bad option value) exits 2, not 1", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run([...TOKEN, "--pagelength", "0", "catalogue", "tables"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("a missing required argument exits 2", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run([...TOKEN, "find"], cli.deps), 2);
});

test("an unknown command exits 2", async () => {
  const cli = makeCli(() => jsonResponse({}));
  assert.equal(await run(["boguscmd"], cli.deps), 2);
});

test("a non-http(s) --base-url is rejected at parse time with exit 2 (GEN-05)", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["--base-url", "file:///etc/passwd", "hello"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("a --base-url with a query, fragment or surrounding whitespace is a usage error", async () => {
  for (const [url, pattern] of [
    ["http://127.0.0.1:18108/m/ok?x=1", /query \(\?\) or fragment \(#\)/],
    ["http://127.0.0.1:18108/m/ok#frag", /query \(\?\) or fragment \(#\)/],
    [" https://genesis.destatis.de", /surrounding whitespace/],
  ] as const) {
    const cli = makeCli(() => jsonResponse(fx.findResult));
    const code = await run(["--base-url", url, "find", "x"], cli.deps);
    assert.equal(code, 2, url);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), pattern);
  }
});

test("a --base-url with a path prefix still works", async () => {
  const cli = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run(["--base-url", "http://mirror.test/genesis/", "--guest", "find", "x"], cli.deps), 0);
  assert.equal(cli.mt.last().url, "http://mirror.test/genesis/genesisWS/rest/2020/find/find");
});

test("a --base-url with embedded userinfo is rejected at parse time (GEN-05/GEN-02)", async () => {
  const cli = makeCli(() => jsonResponse(fx.whoami));
  const code = await run(["--base-url", "https://USER:PASS@genesis.destatis.de", "hello"], cli.deps);
  // Rejected before any request is issued, with the conventional usage exit code.
  // Commander echoes the rejected value in its usage error; run() redacts the
  // userinfo from every line it prints (P1), so the password never shows.
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Must not embed credentials/);
  assert.doesNotMatch(cli.err.join("\n"), /USER:PASS/);
});

// A blank value ("" or whitespace, often an unset shell variable) for a filter,
// selection, code or year is never meaningful: it must be a usage error at parse
// time rather than an empty POST parameter (`area=`) that runs the command anyway.
const BLANK_CASES: { label: string; argv: string[] }[] = [
  { label: "catalogue tables <selection>", argv: ["catalogue", "tables", ""] },
  { label: "catalogue tables <selection> (whitespace)", argv: ["catalogue", "tables", "   "] },
  { label: "catalogue values <selection>", argv: ["catalogue", "values", ""] },
  { label: "catalogue tables --area", argv: ["catalogue", "tables", "124*", "--area", ""] },
  { label: "catalogue statistics --type", argv: ["catalogue", "statistics", "124*", "--type", ""] },
  { label: "metadata table --area", argv: ["metadata", "table", "12411-0001", "--area", ""] },
  { label: "data table --area", argv: ["data", "table", "12411-0001", "--area", ""] },
  { label: "data table --start-year", argv: ["data", "table", "12411-0001", "--start-year", ""] },
  { label: "data table --end-year", argv: ["data", "table", "12411-0001", "--end-year", ""] },
  { label: "data cube --region-var", argv: ["data", "cube", "12411BJ001", "--region-var", ""] },
  { label: "data cube --region-key", argv: ["data", "cube", "12411BJ001", "--region-key", ""] },
  { label: "data table --contents", argv: ["data", "table", "12411-0001", "--contents", ""] },
  { label: "data table --stand", argv: ["data", "table", "12411-0001", "--stand", ""] },
  { label: "data tablefile --class-var1", argv: ["data", "tablefile", "12411-0001", "--class-var1", ""] },
  { label: "data tablefile --class-key1", argv: ["data", "tablefile", "12411-0001", "--class-key1", ""] },
  { label: "data table --class-var2", argv: ["data", "table", "12411-0001", "--class-var2", ""] },
  { label: "data table --class-key2", argv: ["data", "table", "12411-0001", "--class-key2", ""] },
  { label: "data timeseries --class-var3", argv: ["data", "timeseries", "12411JJ001", "--class-var3", ""] },
  { label: "data timeseries --class-key3", argv: ["data", "timeseries", "12411JJ001", "--class-key3", ""] },
  { label: "data result --class-var4", argv: ["data", "result", "RESULT1", "--class-var4", ""] },
  { label: "data result --class-key4", argv: ["data", "result", "RESULT1", "--class-key4", ""] },
  { label: "data cubefile --class-var5", argv: ["data", "cubefile", "12411BJ001", "--class-var5", ""] },
  { label: "data cubefile --class-key5 (whitespace)", argv: ["data", "cubefile", "12411BJ001", "--class-key5", "  "] },
];

for (const { label, argv } of BLANK_CASES) {
  test(`a blank value is rejected before any request: ${label}`, async () => {
    const cli = makeCli(() => jsonResponse(fx.tablesList));
    const code = await run([...TOKEN, ...argv], cli.deps);
    assert.notEqual(code, 0);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /non-empty/);
  });
}

test("-o - writes to stdout and creates no file named '-' (P12)", async () => {
  const json = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run(["-o", "-", "--compact", "--guest", "find", "x"], json.deps), 0, json.err.join("\n"));
  assert.equal(json.files.size, 0);
  assert.deepEqual(JSON.parse(json.out.join("")), fx.findResult);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const raw = makeCli(() => rawResponse(zip, "application/zip"), { DESTATIS_API_TOKEN: "TOK" });
  assert.equal(await run(["data", "tablefile", "12411-0001", "-o", "-"], raw.deps), 0, raw.err.join("\n"));
  assert.equal(raw.files.size, 0);
  assert.match(untimed(raw.err.join("\n")), /^INFO  \[destatis\.output\] Wrote 6 bytes to stdout/m);
});

test("P20: a remote http base URL warns once, naming what travels: nothing, the token or the login", async () => {
  const warningsOf = async (argv: string[], env: Record<string, string> = {}) => {
    const cli = makeCli((req) => jsonResponse(req.url.endsWith("/whoami") ? fx.whoami : fx.findResult), env);
    const code = await run(["--base-url", "http://mirror.example:8080", ...argv], cli.deps);
    assert.equal(code, 0, cli.err.join("\n"));
    return cli.err.map(untimed).filter((l) => l.startsWith("WARN "));
  };
  assert.deepEqual(await warningsOf(["--guest", "find", "x"]), [
    "WARN  [destatis.http] requests to mirror.example:8080 are sent unencrypted (http:, not https:)",
  ]);
  assert.deepEqual(await warningsOf(["find", "x"], { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" }), [
    "WARN  [destatis.http] the token is sent unencrypted to mirror.example:8080 (http:, not https:)",
  ]);
  assert.deepEqual(await warningsOf(["find", "x"], { DESTATIS_USERNAME: "testuser01", DESTATIS_PASSWORD: "s3cret-Test-Pw" }), [
    "WARN  [destatis.http] the login is sent unencrypted to mirror.example:8080 (http:, not https:)",
  ]);
  // hello never sends credentials, so its warning names none even when they are set.
  assert.deepEqual(await warningsOf(["hello"], { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" }), [
    "WARN  [destatis.http] requests to mirror.example:8080 are sent unencrypted (http:, not https:)",
  ]);
});

test("P20: a usage error does not warn about http", async () => {
  const cli = makeCli(() => jsonResponse(fx.tablesList));
  const code = await run(["--base-url", "http://mirror.example", "catalogue", "tables", "--username", "USER123456"], cli.deps);
  assert.equal(code, 2);
  assert.deepEqual(cli.err.map(untimed).filter((l) => l.startsWith("WARN ")), []);
});

test("a flat Code 2 on HTTP 200 from a data endpoint exits 1 with the credentials hint", async () => {
  const cli = makeCli(() => jsonResponse(fx.flatBadCredentials), { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" });
  const code = await run(["data", "table", "12411-0001"], cli.deps);
  assert.equal(code, 1);
  assert.deepEqual(cli.out, []);
  assert.match(cli.err.join("\n"), /GENESIS status 2 \(ERROR\) \/ HTTP 200/);
  assert.match(untimed(cli.err.join("\n")), /^INFO  \[destatis\.api\] check your credentials/m);
});

test("an a:b@c argument (here a User-Agent) is neither a credential in the log nor rewritten in the JSON on stdout (L14)", async () => {
  const env = { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" };
  const cli = makeCli(() => jsonResponse({ ...fx.findResult, Copyright: "run:2026-10-09@x" }), env);
  assert.equal(await run(["--user-agent", "run:2026-10-09@x", "find", "x"], cli.deps), 0, cli.err.join("\n"));
  assert.match(cli.out.join("\n"), /"Copyright": "run:2026-10-09@x"/);
  const written = makeCli(() => jsonResponse(fx.findResult), env);
  assert.equal(await run(["-o", "run:2026-10-09@x.json", "find", "x"], written.deps), 0);
  assert.match(untimed(written.err.join("\n")), /Wrote \d+ bytes to run:2026-10-09@x\.json/);
  assert.deepEqual(credentialsIn("run:2026-10-09@x"), []);
  assert.deepEqual(credentialsIn("https://alice:pw@host"), ["alice:pw"]);
});

test("a parse error is logged in the format commander would have parsed: the first --log-format, an option's value skipped (L6)", async () => {
  // --user-agent takes "--log-format" as its value; "jsonl" is then an unknown command, logged in text.
  const ua = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run(["--user-agent", "--log-format", "jsonl", "find", "x"], ua.deps), 2);
  assert.match(ua.err[0] ?? "", /^\S+ ERROR \[destatis\.cli\] unknown command 'jsonl'/);
  // A repeated --log-format is refused; the refusal is in the first one's format.
  const twice = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run(["--log-format", "jsonl", "--log-format", "text", "find", "x"], twice.deps), 2);
  const record = JSON.parse(twice.err[0] ?? "") as Record<string, unknown>;
  assert.equal(record["topic"], "destatis.cli");
  assert.match(record["msg"] as string, /--log-format <format>' was given more than once/);
});

test("a subcommand's value option does not swallow the program's --log-format, in a parse error too (L6)", async () => {
  // commander takes the program's --log-format out of argv first; --start-year is left without its value.
  const cli = makeCli(() => jsonResponse(fx.findResult));
  assert.equal(await run(["data", "table", "12411-0001", "--start-year", "--log-format", "jsonl"], cli.deps), 2);
  assert.ok(cli.err.length > 0 && cli.err.every((line) => line.startsWith("{")), cli.err.join("\n"));
  assert.match((JSON.parse(cli.err[0] ?? "") as Record<string, unknown>)["msg"] as string, /--start-year <year>' argument missing/);
});

test("every -o failure is an ERROR record of destatis.output: a refused target exit 2 before any request, a failed write exit 1 (L8, K7)", async () => {
  const refused = makeCli(() => jsonResponse(fx.tablesList));
  refused.files.set("out.json", Buffer.from("existing")); // an existing file, no --force
  assert.equal(await run([...TOKEN, "-o", "out.json", "catalogue", "tables"], refused.deps), 2);
  assert.equal(refused.mt.calls.length, 0);
  assert.match(untimed(refused.err.join("\n")), /^ERROR \[destatis\.output\] Refusing to overwrite/m);
  const failures: Array<(cli: ReturnType<typeof makeCli>) => void> = [
    (cli) => {
      cli.deps.io.writeFile = () => {
        throw new Error("EACCES: permission denied, open 'out.json'");
      };
    },
    (cli) => {
      cli.deps.io.writeFile = () => {
        throw Object.assign(new Error("EISDIR: illegal operation on a directory, open 'out.json'"), { code: "EISDIR" });
      };
    },
  ];
  for (const fail of failures) {
    const cli = makeCli(() => jsonResponse(fx.tablesList));
    fail(cli);
    assert.equal(await run([...TOKEN, "-o", "out.json", "catalogue", "tables"], cli.deps), 1);
    assert.match(untimed(cli.err.join("\n")), /^ERROR \[destatis\.output\] Could not write to/m);
    assert.doesNotMatch(cli.err.join("\n"), /Unexpected error|ERROR \[destatis\.cli\]/);
  }
});

test("the Content-Type a download is logged with is quoted cut, its control characters gone (#18)", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const type = `application/zip; x=${"y".repeat(10_000)}\u009b31m`;
  const cli = makeCli(() => rawResponse(zip, type), { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" });
  assert.equal(await run(["data", "tablefile", "12411-0001", "-o", "t.zip"], cli.deps), 0, cli.err.join("\n"));
  const record = cli.err.find((line) => line.includes("Wrote ")) ?? "";
  assert.match(record, /Wrote 8 bytes to t\.zip \(Content-Type: application\/zip; x=y+…\)$/);
  assert.ok(record.length < 700, `${record.length}`);
});

test("commander's echo of a refused value shows an invisible or format character escaped, never raw (D10)", async () => {
  const zwsp = String.fromCharCode(0x200b);
  const shy = String.fromCharCode(0x00ad);
  for (const argv of [["--pagelength", `1${zwsp}`, "--guest", "find", "x"], ["--guest", "find", "x", "--category", `tab${shy}les`]]) {
    const cli = makeCli(() => jsonResponse(fx.findResult));
    assert.equal(await run(argv, cli.deps), 2, argv.join(" "));
    const err = cli.err.join("\n");
    assert.ok(!err.includes(zwsp) && !err.includes(shy), err);
    assert.match(err, /\\u200b|\\u00ad/, err);
  }
});

// T15 of the 2026-10-21 fix round (jobsuche-cli 28be809, ladesaeulenregister-cli 001c48d): a URL
// with a password anywhere in an argument — padded, after a dash, inside a phrase — must never
// reach stderr, neither raw in a refusal, a note, a server's echo or commander's echo nor
// percent-encoded in a request URL.
test("a password in a URL inside any argument is redacted on stderr, raw or percent-encoded (T15)", async () => {
  const url = "https://bob:s3cretpw@host.example/x";
  const argvs = [
    ["find", ` ${url}`],
    ["find", `Bevölkerung ${url}`],
    ["find", `-${url}`],
    ["find", "--", `-${url}`],
    ["catalogue", "tables", ` ${url}`],
    ["catalogue", "tables", "12*", "--area", `all ${url}`],
    ["metadata", "table", `12411 ${url}`],
    ["data", "table", "12411-0001", "--region-key", ` ${url}`],
    ["data", "table", "12411-0001", "--contents", `BEVSTD, ${url}`],
    ["data", "table", "12411-0001", `--stand=01.01.2020 ${url}`],
    ["data", "tablefile", ` ${url}`, "-o", "x.zip"],
    ["-o", ` -${url}`, "data", "table", "12411-0001"],
    ["-o", `-${url}`, "data", "table", "12411-0001"],
    [`--output=-${url}`, "hello"],
    ["--user-agent", `agent ${url}\u0001`, "hello"],
    ["--pagelength", `5 ${url}`, "find", "x"],
    ["--language", ` ${url}`, "hello"],
    ["--base-url", ` ${url}`, "hello"],
    ["--base-url", url, "hello"],
    [` ${url}`],
    ["hello", ` ${url}`],
    ["hello", `--bogus= ${url}`],
    ["find", "x", "--bogus", ` ${url}`],
  ];
  const answers = [
    () => jsonResponse({ ...(fx.notFound as object), Status: { Code: 90, Type: "Fehler", Content: `nichts für ${url} gefunden` } }),
    () => rawResponse(`not found: ${url}`, "text/plain", 404),
    () => rawResponse("busy", "text/plain", 503),
  ];
  for (const argv of argvs) {
    for (const answer of answers) {
      const cli = makeCli(answer, { DESTATIS_API_TOKEN: "0123456789abcdef0123456789abcdef" });
      await run(["--max-retries", "0", ...argv], cli.deps);
      const err = cli.err.join("\n");
      assert.doesNotMatch(err, /s3cretpw|bob%3As3|s3cretpw%40/, `${JSON.stringify(argv)}: ${err}`);
    }
  }
});

test("the search for URLs inside an argument is linear: a 1 MB argument is read at once (T15)", async () => {
  // A pattern retried at every position took ~3 s for 40 000 scheme characters without "://".
  for (const big of ["a".repeat(1 << 20), "a://".repeat(1 << 18), `${"a".repeat(1 << 20)}://bob:s3cretpw@h/`]) {
    const started = performance.now();
    const redaction = redactionFor(["find", big], {});
    redaction.err(`x ${big.slice(-40)}`);
    assert.ok(performance.now() - started < 1000, `${big.slice(0, 8)}…: ${Math.round(performance.now() - started)} ms`);
  }
  // At most 64 URLs inside one argument are read; the first ones are redacted.
  const many = Array.from({ length: 100 }, (_, i) => ` https://u${i}:pw${i}xyz@h/`).join("");
  const err = redactionFor(["find", many], {}).err(many);
  assert.ok(!err.includes("pw0xyz") && !err.includes("pw63xyz"), err.slice(0, 200));
});
