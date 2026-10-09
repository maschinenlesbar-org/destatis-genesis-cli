# destatis-genesis-cli

[![CI](https://github.com/maschinenlesbar-org/destatis-genesis-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/destatis-genesis-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/destatis-genesis-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/destatis-genesis-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/destatis-genesis-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/destatis-genesis-cli)

**Website:** [English](https://maschinenlesbar-org.github.io/destatis-genesis-cli/) · [Deutsch](https://maschinenlesbar-org.github.io/destatis-genesis-cli/de/) — command reference, guides and API docs

A TypeScript **API client and CLI** for the **DESTATIS GENESIS-Online REST API**
(version 2020) — the German Federal Statistical Office's official-statistics
database at [www-genesis.destatis.de](https://www-genesis.destatis.de).

Search the catalogue, read object metadata, and pull statistical tables, cubes
and time series from the command line or as a library. Read-only, zero runtime
HTTP dependencies (built on `node:http`/`https`), strict TypeScript, ESM.

```bash
npm install -g @maschinenlesbar.org/destatis-genesis-cli
```

This installs the **`destatis`** command. Requires **Node.js 22.12+**.

## Credentials

GENESIS needs a **free registered account** — register at
[www-genesis.destatis.de](https://www-genesis.destatis.de). Authenticate with
**either** a personal **API token** *or* your **username + password**. No
credential is bundled with this tool.

| How | Flag | Env var |
|-----|------|---------|
| Token (recommended) | `--token <t>` | `DESTATIS_API_TOKEN` |
| Username + password | `--username <u>` / `--password <p>` | `DESTATIS_USERNAME` / `DESTATIS_PASSWORD` |

Precedence per field is **flag > env var**, so `--username` combines with
`DESTATIS_PASSWORD`; a stored login (`destatis config`, below) comes after both. Use
**one** login: a token together with a username or password — from flags, variables
or a mix, e.g. `DESTATIS_API_TOKEN` set while you pass
`--username`/`--password` — is refused (exit 2, naming where each came from, never the
values) instead of one silently winning. Unset the other one. The library refuses the
same combination (`DestatisValidationError`).

**Without an account, say so: `--guest`.** `destatis --guest find …` searches as
GENESIS's guest user `GAST`; `catalogue`, `metadata`, `data` and `logincheck` need an
account and refuse `--guest` (exit 2). There is no silent fallback: a command run with
neither credentials nor `--guest` exits 2 naming both ways, and `--guest` together with
a credential — a flag, or a set `DESTATIS_*` variable — exits 2 too. `destatis hello`
sends no credentials and needs neither. Credentials are sent exactly as given: a
blank credential flag, or one with leading or trailing whitespace (which an HTTP
header cannot carry), is refused with exit 2; a blank env var counts as unset. A
malformed variable fails only a command that uses it: `--help`, `--version` and
`destatis hello` always work, and a flag overrides the variable.
No message repeats a credential: the CLI prints `***` in place of the token,
username and password (from flags, env vars or the credentials file) and of any
`user:pass@` in a URL, wherever they would appear — a usage error, an unknown command, the server's echo.

> **Prefer the environment variables.** A credential passed as a `--token` /
> `--username` / `--password` **flag** is visible in the process table (`ps`,
> `/proc`) to other local users and is persisted in your shell history — the
> account *password* is especially sensitive. The CLI prints a one-line stderr
> warning when it detects a flag-supplied credential. Set the env var instead (it
> takes effect whenever the corresponding flag is absent), or store the login once
> with `destatis config set` (below).

```bash
export DESTATIS_API_TOKEN="your-32-char-token"
```

**Or store it once**, in a credentials file of its own (the same mechanism as
[openka-cli](https://github.com/maschinenlesbar-org/openka-cli)'s `ka config`):

```bash
destatis config set token                          # typed at a prompt, without echo
destatis config set username                       # or a login: username …
destatis config set password                       # … and password
pass show genesis | destatis config set password   # or piped in
destatis config get token                          # masked: 0123…cdef (--reveal prints it whole)
destatis config list                               # what is stored, and where
destatis config unset token
```

The value is never taken from the command line, so it reaches neither shell history
nor `ps`. The file is `$XDG_CONFIG_HOME/destatis-genesis/credentials` (else
`~/.config/destatis-genesis/credentials`): mode 0600 in a directory of mode 0700,
replaced atomically by one writer at a time (`credentials.lock` beside it; a second
`config set` waits up to 2 s, then fails with exit 1 and changes nothing), and not read at all while anyone else could read it. A value is
stored exactly as given — spaces inside a password are fine; a blank value, a line
break or leading/trailing whitespace is refused (exit 2). The file is consulted only
when no flag and no `DESTATIS_*` variable gives **any** credential, and then as a
whole: one login is never pieced together from the file and a flag or variable, so a
stored password does not complete a `DESTATIS_USERNAME`. The file's own login follows
the same rules — a stored token next to a stored username or password, or half a
pair, exits 2. `--guest` and `destatis hello` don't read it; a stored value read is
redacted from everything printed, like a flag's. `get`, `list` and the record `set`
logs show a value masked: a token as `0123…cdef`, a password never (`****`), and any
value below 20 characters as `****` too. `destatis config` prints to stdout only: `-o`
is refused (redirect stdout instead), so a value never lands on the terminal when a
file was asked for.

Precedence is **flags > `DESTATIS_*` variables** (per field) **> the credentials file >
none**.

**Base URL.** `--base-url` (default `https://genesis.destatis.de`) points the CLI
at another GENESIS host. A plain `http:` base URL on a remote host gets one
`WARN` record of `destatis.http` on stderr per run, naming the host and what travels unencrypted
with the requests (`the token`, `the login`), never its value; loopback hosts
(`localhost`, `127.0.0.0/8`, `::1`) don't warn. stdout and the exit code are
unchanged. The library exports the same check as `cleartextProblem(baseUrl, secrets)`.

## Quickstart

```bash
destatis hello                                  # connectivity check (no auth)
destatis logincheck                             # validate your credentials
destatis find "Bevölkerung" --category tables   # search for tables
destatis --guest find "Bevölkerung"             # search without an account
destatis catalogue tables "124*"                # browse tables by code
destatis metadata table 12411-0001              # describe a table
destatis data table 12411-0001 --start-year 2020 --compact
destatis data tablefile 12411-0001 --format ffcsv -o pop.zip
```

Every command prints the API's JSON envelope (including the `Copyright`
attribution and a `Status` object). See **[Usage.md](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/Usage.md)** for the full
command reference and **[GLOSSARY.md](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/GLOSSARY.md)** for GENESIS concepts (EVAS
codes, cubes, `selection` wildcards, `Status.Code` values).

Errors and diagnostics go to stderr, so piping stdout into `jq` stays clean. Each line
on stderr is a **log record**: a timestamp (UTC), a level (`ERROR`, `WARN`, `INFO`) and a
topic, the program and the area it comes from (`destatis.cli` for usage errors and the
credentials-on-the-command-line warning, `destatis.api` for GENESIS's answers and the
credentials hint, `destatis.http` for the connection, `destatis.config`,
`destatis.output`). By default it is written log4j style; `--log-format jsonl` writes one
JSON object per line instead. A record is always one line: a line break, a control
character or a bidi control in a message (a server's text, a value you typed) is written
as an escape (`\n`, `\u001b`, `\u202e`), so it can neither split a record nor forge
another one, nor steer the terminal:

```text
2026-10-09T14:03:12.481Z ERROR [destatis.api] GENESIS status 2 (ERROR) / HTTP 404 for POST https://genesis.destatis.de/genesisWS/rest/2020/metadata/table: Ein Fehler ist aufgetreten. (…)
2026-10-09T14:03:12.483Z INFO  [destatis.api] check your credentials (--token or --username/--password, …)
```

```bash
destatis --log-format jsonl logincheck 2>log.jsonl   # {"ts":"…","level":"ERROR","topic":"destatis.api","msg":"GENESIS …"}
```

## Library use

```ts
import { DestatisClient } from "@maschinenlesbar.org/destatis-genesis-cli";

const genesis = new DestatisClient({ token: process.env.DESTATIS_API_TOKEN });
const hits = await genesis.find({ term: "Bevölkerung", category: "tables" });
const table = await genesis.data.table("12411-0001", { startyear: "2020" });
// table.Object.Content is the table as a ";"-delimited CSV string.

const guest = new DestatisClient({ guest: true }); // whoami() and find() only
```

The access mode is explicit: a client needs credentials (`token`, or `username` +
`password`) or `guest: true`. With neither — e.g. an unset or empty
`DESTATIS_API_TOKEN` — the constructor throws `DestatisValidationError` instead of
quietly running as guest, and `guest: true` with a credential throws too.

Each call accepts only the parameter keys of its endpoint: GENESIS ignores one it
does not know (a misspelt `startYear`) and would answer unfiltered, so the client
rejects it with `DestatisValidationError` before any request. Pass
`{ allowUnknownParams: true }` as the last argument to send a newer parameter anyway.

The client is usable independently of the CLI. Errors are typed
(`DestatisApiError`, `DestatisNetworkError`, `DestatisParseError`,
`DestatisUsageError`). A custom `transport` (e.g. one built on `fetch`) gets the
same guarantees as the built-in one: `timeoutMs` and `maxResponseBytes` are enforced
by the client, a `Headers` object or `Uint8Array` body is read correctly, and
whatever the transport throws arrives as a `DestatisNetworkError`. A transport must
not follow redirects — GENESIS credentials are headers that `fetch` would carry to
another host — so pass `redirect: req.redirect` (always `"manual"`) to `fetch`, and
return `url: r.url`: a response from another origin is then refused.

## Notes

- **HTTP 200 ≠ success.** GENESIS reports logical outcomes in a `Status` object in
  the body; this client inspects `Status.Code` and raises `DestatisApiError` for
  real errors (see [DEVELOPING.md](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/DEVELOPING.md)).
- **The data is Destatis's, not ours** — governed by DL-DE-BY-2.0. See
  **[DATA_LICENSE.md](DATA_LICENSE.md)**.
- **Code license:** AGPL-3.0-or-later **OR** commercial — see
  [LICENSING.md](LICENSING.md). External code contributions are not accepted
  ([CONTRIBUTING.md](CONTRIBUTING.md)); bug reports and forks are welcome.

## Claude Code skills

Three [Agent Skills](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/SKILLS.md) teach Claude Code to use this CLI for real questions:
turn a topic into a GENESIS object code (**destatis-statistics-finder**), fetch and decode its
numbers (**destatis-data-fetch**), and export tables to CSV or Excel
(**destatis-table-download**). Install them from the maschinenlesbar.org marketplace:

```
/plugin marketplace add maschinenlesbar-org/plugins
/plugin install destatis-genesis@maschinenlesbar
```

See **[SKILLS.md](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/SKILLS.md)** for details.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # builds, then runs node --test on dist/test
npm run typecheck
```

See [DEVELOPING.md](https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/DEVELOPING.md) for architecture and API specifics.
