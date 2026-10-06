# Usage

`destatis <command> [options]`. Every command hits the GENESIS-Online 2020 REST
API and prints its JSON envelope (`Ident` / `Status` / `Parameter` / `Copyright`
plus `List` or `Object`). Object codes are EVAS-style (e.g. table `12411-0001`,
statistic `12411`) — find them with `find` / `catalogue`.

## Credentials & global options

Set credentials once (see [README](README.md)). Prefer the **environment
variables** over the flags: a credential passed as a flag is visible in the
process table and shell history, so the CLI warns to stderr when it detects one.
Nothing the CLI prints repeats a credential: the token, username and password
(flag or env var) and any `user:pass@` in a URL show as `***` — in usage errors, in
an unknown command or surplus argument, and in a server answer that echoes them.

```bash
export DESTATIS_API_TOKEN="…"          # or DESTATIS_USERNAME + DESTATIS_PASSWORD
```

Global options (valid on any command). Each option takes one value: giving one
twice (`--start-year 2020 --start-year 2021`, `--token a --token b`) is a usage
error (exit 2), not "the last one wins".

| Flag | Meaning |
|---|---|
| `--token <t>` | API token (env `DESTATIS_API_TOKEN`) |
| `--guest` | run without an account, as the GENESIS guest user — `find` and `hello` only. Required when no credentials are set (no silent guest access); refused together with any credential, flag or `DESTATIS_*` variable (exit 2) |
| `--username <u>` · `--password <p>` | account login (env `DESTATIS_USERNAME` / `DESTATIS_PASSWORD`; a flag beats its variable per field, so `--username` combines with `DESTATIS_PASSWORD`). Not together with a token from `--token` or `DESTATIS_API_TOKEN` (usage error, exit 2, naming the sources) |
| `--base-url <url>` | API base (default `https://genesis.destatis.de`); `http(s)` only, a path prefix is fine, but no query, fragment, userinfo, whitespace or control characters. A remote `http:` URL prints `warning: … sent unencrypted to <host> (http:, not https:)` on stderr once per run, naming `the token` or `the login` when one is sent (never its value); loopback hosts don't warn |
| `--language <de\|en>` | response language (not sent unless given; the server default is `de`; English data labels are partial) |
| `--pagelength <n>` | max list results, `1..25000` (server default 100) |
| `--timeout <ms>` · `--max-retries <n>` · `--max-response-bytes <n>` | transport tuning (`--timeout` at most `2147483647`) |
| `--user-agent <ua>` | User-Agent header |
| `--compact` | single-line JSON |
| `-o, --output <file>` | write output (JSON, or a download) to a file instead of stdout; `-o -` means stdout |
| `--force` | overwrite the `--output` file if it already exists (otherwise the write is refused — also when a symlink, even a dangling one, sits at that path) |

## hello / logincheck

```bash
destatis hello           # helloworld/whoami — needs NO credentials (and no --guest)
destatis logincheck      # helloworld/logincheck — validates your credentials
```

`logincheck` exits **0** only when GENESIS confirms the login. GENESIS answers it
with HTTP 200 either way; wrong credentials come back as an error text in `Status`,
which the CLI reports as `GENESIS login rejected (HTTP 200) …` plus the credentials
hint, exit **1**. Only an explicit success text (with a `Username`) or an explicit
failure decides; anything else — no `Status`, a text that is neither, a success
without `Username` — exits 1 without the hint (`the login was not confirmed`). A
`Username` that echoes the token sent doesn't change the verdict either way. With
`--guest` there is nothing to check: exit 2.

## find — full-text search

```bash
destatis find <term> [--category all|tables|statistics|cubes|variables|time-series]
```

Runs with your credentials, or **without an account when you pass `--guest`**:
GENESIS answers an anonymous search as its guest user `GAST`. Neither credentials nor
`--guest` is a usage error (exit 2) — never a silent guest search — and so is
`--guest` with a credential set. Without `--category` no
category is sent and GENESIS searches every object type. `--pagelength` bounds the
result count. Returns parallel arrays
(`Tables`/`Statistics`/`Cubes`/`Timeseries`/`Variables`), each `null` when not
searched or when nothing of that type matched: a search without hits answers
`Status.Code 0` with its arrays `null` (not `104`), exit 0.

```bash
destatis find "Bevölkerung" --category tables --pagelength 20
destatis --guest find "Bevölkerung" --category tables   # without an account
```

## catalogue — browse objects by code

```bash
destatis catalogue <sub> [selection] [--area <a>] [--search-criterion Code|Content]
                                     [--sort-criterion Code|Content] [--type <t>]
```

`<sub>` ∈ `tables` · `statistics` · `cubes` · `timeseries` · `variables` ·
`values` · `terms` · `jobs` · `modified` · `results` · `qualitysigns`.
`[selection]` filters by code and accepts a `*` wildcard (e.g. `124*`). Alias: `cat`.

```bash
destatis catalogue statistics "12*"
destatis catalogue tables 12411 --sort-criterion Content
```

## metadata — describe an object

```bash
destatis metadata <kind> <name> [--area <a>]
```

`<kind>` ∈ `table` · `statistic` · `cube` · `timeseries` · `variable` · `value`.
Alias: `meta`.

```bash
destatis metadata table 12411-0001
```

## data — fetch statistical data

```bash
destatis data <kind> <name> [selection filters]
```

`<kind>` ∈ `table` · `cube` · `timeseries` · `result`. The result carries the
table as a `";"`-delimited CSV string in `Object.Content` (German number
format — comma decimals; `.` `-` `x` `/` `…` are value-status placeholders).

Selection filters (narrow large tables — see the too-large note below):

| Flag | GENESIS param |
|---|---|
| `--start-year <YYYY>` · `--end-year <YYYY>` | `startyear` / `endyear` |
| `--timeslices <n>` | `timeslices` (from the latest period back) |
| `--region-var <code>` · `--region-key <key>` | `regionalvariable` / `regionalkey` |
| `--class-var1..5 <code>` · `--class-key1..5 <key>` | `classifyingvariable{n}` / `classifyingkey{n}` |
| `--contents <labels>` | `contents` (comma-separated) |
| `--stand <DD.MM.YYYY>` | `stand` (only newer data) |
| `--structure` · `--transpose` · `--compress` | `structureinformation` / `transpose` / `compress` |

```bash
destatis data table 12411-0001 --start-year 2015 --end-year 2023 --class-var1 DLAND
```

### File downloads

```bash
destatis data <kind>file <name> -o <file> [--format datencsv|csv|ffcsv|xlsx|html|genml] [filters]
```

`<kind>file` ∈ `tablefile` · `cubefile` · `timeseriesfile` · `resultfile`. The
server returns a **ZIP** wrapper; the bytes are written as-is to `-o <file>` (or
stdout). `ffcsv` is a tidy/flat CSV with English headers; `datencsv` is the
default.

A JSON or empty reply is never written as a download: it is a GENESIS status the
server sent instead of the file. The CLI then writes nothing and exits non-zero —
**4** for `Status.Code 104` (no object with that code) or `90`, **1** for anything
else (credentials, `98` too large, an empty body). An HTML page (a maintenance or
proxy page) is refused the same way, exit **1** — unless it is a ZIP, or you asked
for `--format html`.

```bash
destatis data tablefile 12411-0001 --format ffcsv -o population.zip
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success (help/version included); also an **empty result** — see note |
| `1` | API/logical error (including wrong or missing credentials), network or parse error |
| `2` | usage error (missing/partial credentials, bad flags/arguments, unknown command) |
| `4` | object not found — the rare `Status.Code 90` / a bare HTTP 404 (see note), and a `data <kind>file` download for a code that does not exist (`Status.Code 104`) |

A reader that stops early (`destatis find … | head`) ends the run quietly with exit
`0`; a failed run keeps its own code even when its stderr reader is gone
(`2>&1 | true`).

> **A missing object code does not exit 4.** Looking up a code that does not exist
> on `metadata`/`data` returns `Status.Code 104` ("Es gibt keine Objekte zum
> angegebenen Selektionskriterium") — a valid **empty** result, so the CLI exits
> **0**, the same as an empty `catalogue` search. (An empty `find` answers
> `Status.Code 0` with its arrays `null` instead.) (A `data <kind>file`
> download is the exception: there `104` means there is nothing to download, so it
> exits **4** and writes no file.) The `90 → 4` mapping is a
> defensive path the server rarely takes. To detect "no such object" in a script,
> inspect `Status.Code` in the payload, not the exit code.

> **Wrong credentials exit 1.** GENESIS answers a wrong username/password or token
> with HTTP 404 and a flat `{"Code":2,"Content":"…Nutzernamen oder Ihren Token bzw.
> das Passwort…","Type":"ERROR"}` body. The CLI reads that body, so the error is
> `GENESIS status 2 (ERROR) / HTTP 404 for POST …: …Nutzernamen…`, followed by a
> credentials hint, and exits **1**. Only a 404 without a GENESIS code exits 4.
> `logincheck` gets the same text on an HTTP 200 instead; it exits **1** with the
> hint too (`GENESIS login rejected (HTTP 200) …`). Should another endpoint send the
> flat Code 2 body on an HTTP 200, it is the same auth error:
> `GENESIS status 2 (ERROR) / HTTP 200 …`, the hint, exit **1**.

## Gotchas

- **Too-large tables.** A table that is too big to return synchronously fails
  with `Status.Code 98`; this read-only CLI does not run the async batch-job
  flow. Narrow the request (`--start-year`/`--end-year`/`--timeslices`/`--region-key`/`--class-key1..5`)
  or download a subset via `data tablefile`. On `catalogue`/`find`, narrow the
  selection or search term, or lower `--pagelength`.
- **Pagination.** GENESIS paginates by `--pagelength` only (no offset/cursor);
  narrow with `selection`/`term` rather than paging.
- **Transient upstream errors.** The GENESIS server is occasionally flaky: an
  individual `find` term or request can return a transient `HTTP 500` or time out,
  and the very same call usually succeeds moments later (the failure moves between
  terms over time — it is not tied to a specific word or to umlauts). Just retry,
  or raise `--timeout`. Note that only `429`/`503` are auto-retried (`--max-retries`,
  each after a linear backoff of 200 ms × attempt, or the server's `Retry-After` when
  that is longer, up to 30 s — a longer one is not retried, and the error names the
  requested wait), **not** `500`, resets or timeouts. Where the server includes a message, the CLI now
  surfaces it in the error text.
- **`"boolean"`/count fields are strings.** List items encode e.g. `Values` /
  `Cubes` counts and flags as JSON strings (`"9"`, `"true"`).
- **Attribution.** Cite the `Copyright` field from each response — see
  [DATA_LICENSE.md](DATA_LICENSE.md).
