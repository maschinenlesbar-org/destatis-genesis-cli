# Developing `destatis-genesis-cli`

This repo follows the shared `*-cli` two-layer blueprint (a typed,
dependency-free client + a commander CLI, both driven through injectable seams).
This document records what is **specific** to the DESTATIS GENESIS-Online API —
read it alongside [GLOSSARY.md](GLOSSARY.md).

## Layout

```
src/
  client/        # typed API client, usable as a library independent of the CLI
    types.ts     # GENESIS envelope + catalogue/find list items (opaque data/metadata Objects)
    params.ts    # per-endpoint parameter interfaces
    query.ts     # dependency-free query-string builder
    http.ts      # Transport interface + default node:http/https transport
    engine.ts    # URL building, retry, Status.Code logical-error mapping, URL redaction
    errors.ts    # Destatis{Error,ApiError,NetworkError,UsageError,ParseError}
    client.ts    # DestatisClient — helloworld/find + catalogue/metadata/data groups
    index.ts
  cli/
    io.ts        # injectable I/O + env seam (CliDeps / CliIO)
    shared.ts    # option parsers, credential resolution, option->client mapping, render
    commands/    # hello, find, catalogue, metadata, data
    program.ts   # assembles the commander program; seeds credential flags from env
    run.ts       # argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
  index.ts       # library entry
```

Two seams keep everything testable in-process: **`Transport`** (the only HTTP
seam; tests inject a mock) and **`CliDeps`** (client factory + I/O + `env`).
`run.ts` returns an exit code rather than calling `process.exit`.

```bash
npm install
npm run build       # tsc -> dist/
npm run typecheck
npm test            # pretest builds, then node --test dist/test/*.test.js
npm start -- --help # run the built CLI
```

## GENESIS-specific divergences

The GENESIS API differs from most sibling repos in four ways an editor must
preserve:

### 1. Auth is POST with credentials in HTTP header fields

**Verified against the live 2020 endpoint** (the legacy GET-with-query-param
style is dead — the server 302-redirects it to an announcement page). Every
authenticated call is a **`POST`** with:

- an `application/x-www-form-urlencoded` **body** carrying the parameters
  (`buildQueryString` doubles as the form encoder), and
- the credentials in **header fields**: `username` (the 32-char API token *or* the
  account username) and, only in username/password mode, `password`. There is
  **no** `Authorization`/`X-API-Key` header.

Only `helloworld/whoami` is an unauthenticated **`GET`**. The client
(`client.ts`) supplies the credential headers via `postJson`/`postRaw`; the CLI
resolves credentials with precedence **flag > env > unset** (`--token` seeded from
`DESTATIS_API_TOKEN`, etc., in `program.ts`; validated in
`shared.ts:resolveCredentials`). A token wins over username/password; supplying
only one of username/password is a `DestatisUsageError` (exit 2).

Two things the transport MUST get right (both found by live testing):

- **`Content-Type` needs `; charset=UTF-8`.** Without it GENESIS decodes the body
  as Latin-1, so a UTF-8 umlaut (`Bevölkerung`) arrives mojibaked and matches
  nothing. `engine.ts:FORM_CONTENT_TYPE` sets it.
- **Always send `Content-Length`** (even `0`) — GENESIS answers `411` to a POST
  without one.

**Redirects are NOT followed.** The canonical host `genesis.destatis.de` answers
directly; the legacy `www-genesis.destatis.de` host cross-origin-redirects (`307`)
to it, and following that would forward the credential headers to another origin.
A 3xx therefore surfaces as an error hinting at the canonical host.
`engine.ts:redactUrl` additionally scrubs any `username`/`password` that a caller
managed to put in a URL (defensive — this client keeps them in headers).

### 2. HTTP 200 does not mean success

GENESIS answers HTTP 200 for most *logical* errors and carries the real outcome
in a `Status` object (`{ Code, Content, Type }`). After a successful parse,
`engine.ts:checkLogicalStatus` inspects it:

| `Status.Code` | Handling |
|---|---|
| `0`, `22` (auto-corrected), `50` (no newer data) | success — returned as-is (the envelope's `Status.Content` carries any warning) |
| `104` | **empty result** — returned as a valid empty list, NOT an error |
| `90` | object not found → `DestatisApiError`, `isNotFound` (exit 4) |
| `98` | too large → `DestatisApiError` with narrowing guidance (exit 1) |
| any `Type` = `Fehler`/`Error` | → `DestatisApiError` (exit 1) |

Key off the numeric `Code`, never the German/English `Type` text alone.
`DestatisApiError` carries both an optional HTTP `httpStatus` (transport/auth
failures) and an optional logical `code` (`Status.Code`); `run.ts` branches on
them for exit codes.

### 3. `data/*` payloads are opaque

`data/table` (and cube/timeseries/result) return the whole table as a
`";"`-delimited **CSV string** inside `Object.Content` (German number format).
The client keeps `Object` opaque (`DataObject { Content?: string }`) — CSV
parsing is intentionally out of scope; render the envelope as JSON or download a
file. `metadata/*` `Object` shapes vary per method and are likewise `JsonObject`.

### 4. The async batch-job flow is NOT implemented (v1)

Large results come back with `Status.Code 98`. The full flow (re-issue with
`job=true`, poll `catalogue/results`, download `data/resultfile`) requires
**username+password** (a token cannot start jobs) and a write op to clean up
(`profile/removeresult`), so it is deliberately omitted from this read-only tool.
The engine turns a `98` into a clear error telling the user to narrow the
selection. A future `--job` sub-flow (gated on username+password) is the natural
extension point.

## Conventions matched from the blueprint

- **Zero runtime HTTP dependencies** — only `commander`. Strict TS + ESM.
- **Exit codes** (`run.ts`): help/version → 0; usage/credential error → 2;
  not-found → 4; other errors → 1.
- **Retry/backoff:** transient `429`/`503` retried up to `maxRetries`. Note
  GENESIS rate-limits on *concurrency* (~3 parallel) and does not reliably emit
  `429`/`503`, so this path is largely inert — keep it, don't rely on it.
- **`--base-url`** accepts only `http:`/`https:`. Pointing it at the sibling
  Regionalstatistik/Zensus installations is possible but out of scope; the data
  terms may differ (rely on the response `Copyright`).

## Testing

`node --test` on the compiled output; no jest/vitest. Tests inject a mock
`Transport` and a mocked `CliDeps` (`test/helpers.ts`, `test/fixtures.ts`). The
GENESIS-specific behaviour under test: `Status.Code` mapping (`engine.test.ts`),
credential injection + token precedence (`client.test.ts`), the credential guard
/ exit codes / env seeding (`cli.test.ts`).

## Verified against a live account (2026-07-03)

Confirmed with a real API token — `hello`, `logincheck`, `find`, `catalogue`,
`metadata`, `data table` (real figures), and `data tablefile` (a valid ZIP) all
work end to end:

- **Transport:** POST + credential headers + `charset=UTF-8` form body (§1). The
  legacy GET+query style is gone.
- **Host:** `genesis.destatis.de` (the default). `www-genesis.destatis.de`
  `307`-redirects to it (cross-origin).
- **`area`:** not sent by default; the server applies `Öffentlich`.
- **`find` categories:** `all` / `tables` / `statistics` / `cubes` / `variables` /
  `time-series` are all valid (the API maps them to German internally, e.g.
  `tables` → `Tabellen`).
- **Not found:** a missing object code (`metadata`/`data`) returns
  `Status.Code 104` ("keine Objekte zum Selektionskriterium") — a valid **empty**
  result (exit 0), the same code an empty catalogue/find search returns. The
  `90 → exit 4` mapping remains as a defensive path per the API docs.
- **Flakiness:** `find/find` intermittently returns **HTTP 500** under load —
  GENESIS throttles on *concurrency* (~3 parallel; `logincheck` reports killing
  long-running parallel requests) and surfaces it as a 500 rather than 429/503, so
  the built-in retry does not catch it. Keep requests serial; retry a 500 manually.

## Still open

- Full `Status.Code` catalogue for finer exit-code mapping (only 0/22/50/90/98/104
  observed).
- Whether to add HTTP 500 to the retry set (currently no — a 500 may be a real
  error, not only throttling).
- The async batch-job flow (below) — never exercised.
