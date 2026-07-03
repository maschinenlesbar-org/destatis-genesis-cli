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

### 1. Auth is credentials-in-the-URL, not a header

There is **no** `Authorization`/`X-API-Key` header. GENESIS accepts either a
32-char **API token placed in the `username` field** (password omitted) or a
**username + password** pair, sent as **query parameters**. The client
(`client.ts`) merges the credential query params into every request except
`helloworld/whoami`; the CLI resolves them with precedence **flag > env > unset**
(`--token` seeded from `DESTATIS_API_TOKEN`, etc., in `program.ts`; validated in
`shared.ts:resolveCredentials`). A token wins over username/password. Supplying
only one of username/password is a `DestatisUsageError` (exit 2).

Because credentials ride in the URL:

- **Error messages are redacted.** `engine.ts:redactUrl` masks `username`/
  `password` before any URL reaches an error or stderr. Keep this on every path
  that surfaces a URL.
- **Redirects are NOT followed.** A 3xx would risk sending the credential query
  string to another host, so the engine treats any 3xx as an error rather than
  following it. (This is the documented per-repo redirect policy for this API.)

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

## Open questions (verify against a live account)

- Whether GET-with-query-param credentials keeps working for **all** methods
  (the v5.1 guide's stated direction is POST with header fields; every wrapper
  uses GET and the live server honours it). The transport already accepts a
  `body`, so a POST switch is contained.
- Exact `area` literal for public reads (`all` is the default here).
- The `find` `category` literal for time series (`time-series` vs `timeseries`).
- Full `Status.Code` catalogue for finer exit-code mapping.
