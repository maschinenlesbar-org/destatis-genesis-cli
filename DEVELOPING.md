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
    validate.ts  # input rules (…Problem functions) + assertValid
    query.ts     # dependency-free query-string builder
    http.ts      # Transport interface + default node:http/https transport
    engine.ts    # URL building, retry, Status.Code logical-error mapping, URL redaction
    errors.ts    # Destatis{Error,ApiError,NetworkError,UsageError,ValidationError,ParseError}
    client.ts    # DestatisClient — helloworld/find + catalogue/metadata/data groups
    index.ts
  cli/
    io.ts        # injectable I/O + env seam (CliDeps / CliIO)
    shared.ts    # option parsers, credential resolution, option->client mapping, render
    commands/    # hello, find, catalogue, metadata, data
    program.ts   # assembles the commander program; seeds credential flags from env (unchecked)
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

## Library input validation

The library owns every rule about what a request may contain; the CLI only turns
argv strings into typed values and calls the same rules. The rules are pure,
exported `…Problem(value)` functions in `src/client/validate.ts` (they return the
reason a value is invalid, or `undefined`). The client enforces them before any
request through `assertValid(name, value, problem)`, which throws
**`DestatisValidationError`** (`Invalid <name>: <reason>`); a client method
rejects its promise, a constructor throws. `DestatisValidationError` extends
`DestatisUsageError`, so `run.ts` maps it to exit 2 and prints `Error: <message>`.
The CLI's commander parsers call the same `…Problem` functions and turn a reason
into commander's `InvalidArgumentError` (exit 2 too).

What the library rejects:

- **Blank text** (`nonBlankProblem`, `assertRequestParams`): a blank (`""` or
  whitespace-only) object `name`, `find` `term`, or any given string parameter
  (`selection`, `area`, `type`, `regionalkey`, `classifyingkey1`, …). GENESIS reads
  an empty parameter as "no filter", so it would silently return unfiltered data.
  `undefined` still means "omitted". The CLI's `parseNonEmpty` calls the same rule.
- **Values outside a GENESIS value list** (`oneOfProblem`): `language` must be one of
  `LANGUAGES` (`de`, `en`), `find`'s `category` one of `FIND_CATEGORIES`, and
  `searchcriterion`/`sortcriterion` one of `CRITERIA` (`Code`, `Content`), and a
  `data/*file` download's `format` one of `DATA_FILE_FORMATS` — exact,
  case-sensitive. The lists are exported from `params.ts` and the types derive from
  them; the CLI builds its `.choices()` from the same exports.
- **Out-of-range counts** (`intRangeProblem`): `pagelength` must be an integer from 1
  to `MAX_PAGELENGTH` (25000, exported from `params.ts`), `timeslices` a
  non-negative integer — `0`, `-1`, `1.5`, `NaN`, `Infinity` and `25001` never reach
  the server. The CLI's `parseBoundedInt` parses the string and applies the same
  rule; `--pagelength` takes its bound from `MAX_PAGELENGTH`.
- **Header values** (`headerValueProblem`, `credentialProblem`, `headerNameProblem`):
  `userAgent` and every `defaultHeaders` value must be non-blank, free of control
  characters (CR/LF included, tab allowed) and within Latin-1; a `defaultHeaders`
  name must be an HTTP token. Only `userAgent: undefined` selects the default. A
  `token`/`username`/`password` must also have no leading or trailing whitespace.
  A *blank* credential still counts as unset in the library (so
  `token: process.env.DESTATIS_API_TOKEN` works with an empty variable), and so
  does a blank credential env var in the CLI; only a blank credential *flag* is a
  CLI usage error, because it would silently cancel an env credential. Messages
  never echo the value. The CLI's `parseHeaderValue`/`parseCredential` (and the
  env-var check, `checkEnvCredentials` in `shared.ts`) call the same rules. A
  credential variable is checked only when a command uses its value (P19):
  `program.ts` seeds it unchecked (value source `env`), and `action()` checks what
  `resolveCredentials` picked, so `--help`, `--version`, `help` and `hello` (which
  sends no credentials, `action(…, { credentials: false })`) never fail on it, and
  neither does a run whose flag overrides it. `find` does use configured
  credentials, so a malformed variable still stops it rather than silently
  searching as the guest user. The secret flags use
  `parseSecret`, which throws `DestatisUsageError` naming the flag and the reason
  only (commander's own wording, `argument '<value>' is invalid`, would print the
  password).
- **Secrets in library objects** (P2): the client keeps the token, username and
  password in real `#private` fields, so `console.log(client)`, `util.inspect` and
  `JSON.stringify` never show them. Every error the engine raises is scrubbed of the
  request's credential values (raw, JSON- and URL-escaped; `redactSecrets`): the
  `message`, `detail` and `body` of a `DestatisApiError` (a server may echo them —
  `logincheck` returns the token as `Username`), a transport's error text and the
  `cause` chain (`scrubThrown` copies an error only when its text carries one).
- **Redaction on output** (`run.ts`, `withRedactedOutput`, P1): commander echoes
  rejected values and names unknown commands and options as typed, so `run()`
  wraps `deps.io` first and replaces, on stdout and stderr, the userinfo of every
  URL-like argument (`credentialsIn`, exported, parseable or not) with `***@`, and
  the whole values of `--token`/`--username`/`--password`, of the three
  `DESTATIS_*` variables and of any token-shaped argument (`looksLikeToken`) with
  `***` (`redactSecrets`: whole occurrences only, values under 4 characters
  skipped). `withoutStrayValues` drops the value from commander's "too many
  arguments" and `--x=value` "unknown option" errors, and from "unknown command"
  unless it reads like a command name — that is where a secret typed without its
  flag lands.
- **Base URL** (`baseUrlProblem`, run by the engine constructor on the raw
  `baseUrl` before the trailing-slash strip): an unparsable URL, a scheme other
  than `http:`/`https:`, embedded userinfo (`https://u:p@host` would become a Basic
  `Authorization` header; GENESIS never uses Basic auth), a query or fragment
  (request paths are appended as a string, so `?`/`#` would swallow them),
  surrounding whitespace (`"https://h/ "` requested `/%20/…`), and whitespace or
  control characters inside it. This is a configuration error, so it throws
  `DestatisValidationError`, not `DestatisNetworkError`; only the default
  transport's per-hop scheme check (`http.ts`) is a network error. Messages never
  echo the URL. `parseBaseUrl` calls `baseUrlProblem` and only appends the flag
  hint for an embedded credential.
- **Numeric engine options** (`intRangeProblem`): `timeoutMs` (0..`MAX_TIMEOUT_MS`),
  `maxRetries` (0..`MAX_RETRIES`, 10), `retryDelayMs` (0..`MAX_RETRY_AFTER_MS`) and
  `maxResponseBytes` (0..`Number.MAX_SAFE_INTEGER`) must be integers in range;
  `undefined` keeps the default. A constructor-time rejection is a
  `DestatisValidationError` (`Invalid maxRetries: Must be <= 10.`) with the same
  reason the CLI's `parseBoundedInt`/`parseIntArg` give for `--timeout`,
  `--max-retries` and `--max-response-bytes`.
- **Half a credential pair** (`credentialPairProblem`): with no token, a
  `username` without a `password` (or the reverse) throws at construction —
  `Invalid credentials: Provide both username and password (or a token).` A lone
  username used to go out in the token's wire format, a lone password was dropped.
  The CLI's `resolveCredentials` keeps only the flag > env precedence; `action()`
  builds the client first and rewords this error with the flags and env vars.
- **No credentials for an account-only endpoint** (`credentialsRequiredProblem`):
  `catalogue.*`, `metadata.*`, `data.*` and `logincheck()` reject before any
  request when the client has no credentials (a blank one counts as none) —
  `Invalid credentials: This endpoint needs an account (a token, or a username and
  password).` Anonymously GENESIS would answer 401 + Code 15 after the round trip.
  `whoami()` and `find()` keep their optional credentials. The CLI has no guard of
  its own: `action()` rewords this error with the flags, env vars and signup URL.

Request defaults: neither side fills in a value the caller did not give. The CLI
has no `.default()` for `--language` or `find --category`, so an omitted value is
not sent — by the CLI or the library — and GENESIS applies its own defaults
(`de`, `all`); the help text says so.

## GENESIS-specific divergences

The GENESIS API differs from most sibling repos in four ways an editor must
preserve (§5 is the library's side of the transport seam):

### 1. Auth is POST with credentials in HTTP header fields

**Verified against the live 2020 endpoint** (the legacy GET-with-query-param
style is dead — the server 302-redirects it to an announcement page). Every
authenticated call is a **`POST`** with:

- an `application/x-www-form-urlencoded` **body** carrying the parameters
  (`buildQueryString` doubles as the form encoder), and
- the credentials in **header fields**: `username` (the 32-char API token *or* the
  account username) and, only in username/password mode, `password`. There is
  **no** `Authorization`/`X-API-Key` header.

Only `helloworld/whoami` is an unauthenticated **`GET`**. `find/find` is a POST
that GENESIS also serves without credentials, as its guest user `GAST` (checked
live 2026-09-26; `catalogue`/`metadata`/`data` answer 401 + Code 15 then), so the
client's `find()` does not demand credentials while the account-only groups do
(`requireAuth()` in `client.ts`, see above). The client
(`client.ts`) supplies the credential headers via `postJson`/`postRaw`; the CLI
resolves credentials with precedence **flag > env > unset** (`--token` seeded from
`DESTATIS_API_TOKEN`, etc., in `program.ts`; values checked by the library's
`credentialProblem`, precedence in `shared.ts:resolveCredentials`). A token wins over username/password, except that
a `--username`/`--password` *flag* beats an env-only token (commander's value
source tells flag from env); supplying only one of username/password is
rejected by the library (see below) and reworded by the CLI with the flags (exit 2).

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
| `104` | **empty result** — returned as a valid empty list, NOT an error (except on a `data/*file` download, below) |
| `90` | object not found → `DestatisApiError`, `isNotFound` (exit 4) |
| `98` | too large → `DestatisApiError` with narrowing guidance (exit 1) |
| any `Type` = `Fehler`/`Error` | → `DestatisApiError` (exit 1) — also when `Code` is missing or not numeric |

A numeric-string `Code` (`"90"`) counts as that number (`statusCode()`), since
GENESIS stringifies many fields.

A `data/*file` endpoint answers with a file (a ZIP wrapper), so `postRaw` treats
any JSON or empty reply as a failure rather than a download: an empty body or JSON
without a GENESIS status → `DestatisParseError`; a GENESIS status → the mapping
above, and otherwise a `DestatisApiError` carrying that status — `104` included,
which there means "no such object" (`isNotFound`, exit 4). Nothing is written.

Auth failures skip the envelope: GENESIS sends a flat `{ Code, Content, Type }`
body on a non-2xx status. `toApiError` reads it (enveloped or flat, via
`genesisStatus`), so the error carries both the HTTP status and the GENESIS
`code`/`statusType`/`detail` (message `GENESIS status 2 (ERROR) / HTTP 404 for …`):

| Flat `Code` | HTTP | Handling |
|---|---|---|
| `15` (not authorized / credentials not recognized) | 401 | `DestatisApiError`, `isAuthError` → credentials hint (exit 1) |
| `2` (wrong username/password or token) | **404** | `DestatisApiError`, `isAuthError` → credentials hint (exit 1). `isNotFound` ignores a 404 that carries a GENESIS code (seen live on 2026-09-15 for both a wrong login and a wrong token) |

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

### 5. The transport contract is the engine's, not the transport's

`Transport` is exported, so library users plug in `fetch` or their own `node:http`
wrapper. The engine (`request()`/`callTransport()` in `engine.ts`) keeps its promises
for every transport (P5):

- **`timeoutMs`** — the call runs under an overall deadline: the request carries an
  `AbortSignal` (`HttpRequest.signal`, which the default transport honours and a fetch
  transport passes on) and the engine rejects with `DestatisNetworkError` at the
  deadline whether the transport stops or not.
- **`maxResponseBytes`** — checked again on the body the transport hands back
  (`sizeLimitMessage` names the option and `--max-response-bytes`).
- **Response shape** — `headers` may be a `Headers` object, a `Map` or a record with
  names in any case (`plainHeaders`), so `Retry-After` and `Content-Type` are read;
  `body` may be any `ArrayBuffer` view or `ArrayBuffer`, from any realm (`bodyBytes`).
  Anything else (`responseProblem`: no status, no headers, a string body) is a
  `DestatisNetworkError`.
- **Errors** — whatever a transport throws (fetch's `TypeError`, a string, `null`)
  becomes a `DestatisNetworkError` naming the request, with the original (scrubbed)
  as `cause`. A reset is not retried, from any transport: only 429/503 are.

## Conventions matched from the blueprint

- **Zero runtime HTTP dependencies** — only `commander`. Strict TS + ESM.
- **Exit codes** (`run.ts`): help/version → 0; usage/credential error → 2;
  not-found → 4; other errors → 1.
- **Retry/backoff:** transient `429`/`503` retried up to `maxRetries` (0..10),
  each after the response's `Retry-After` (delay-seconds or an IMF-fixdate; a
  malformed one falls back to linear backoff, one above 30 s is not retried). Note
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
  observed in the envelope; 2 and 15 in flat auth-error bodies).
- Whether to add HTTP 500 to the retry set (currently no — a 500 may be a real
  error, not only throttling).
- The async batch-job flow (below) — never exercised.

## Website

The project website — <https://maschinenlesbar-org.github.io/destatis-genesis-cli/> in English
and <https://maschinenlesbar-org.github.io/destatis-genesis-cli/de/> in German — is built from
`site/` with [Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web
components and [Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the
TypeDoc API reference under `/api/`. Its content comes from this repository: the README intro
and quick start, the command tree of the built CLI (`site/scripts/cli-reference.mjs`),
`Usage.md`, `GLOSSARY.md` and its German version `GLOSSARY.de.md`, the skills, and the skill
examples in `EXAMPLE.md` and `EXAMPLE.de.md`. The only repo-specific files are
`site/_config.yml` and `site/_data/project.yml` (the German intro and the access requirements);
the rest of `site/` is identical in every maschinenlesbar.org CLI, so change it in all of them
together. When the README intro changes, update the German intro in `site/_data/project.yml`.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/destatis-genesis-cli/
```
