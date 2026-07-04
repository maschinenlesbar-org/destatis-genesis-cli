# Usage

`destatis <command> [options]`. Every command hits the GENESIS-Online 2020 REST
API and prints its JSON envelope (`Ident` / `Status` / `Parameter` / `Copyright`
plus `List` or `Object`). Object codes are EVAS-style (e.g. table `12411-0001`,
statistic `12411`) — find them with `find` / `catalogue`.

## Credentials & global options

Set credentials once (see [README](README.md)):

```bash
export DESTATIS_API_TOKEN="…"          # or DESTATIS_USERNAME + DESTATIS_PASSWORD
```

Global options (valid on any command):

| Flag | Meaning |
|---|---|
| `--token <t>` | API token (env `DESTATIS_API_TOKEN`) |
| `--username <u>` · `--password <p>` | account login (env `DESTATIS_USERNAME` / `DESTATIS_PASSWORD`) |
| `--base-url <url>` | API base (default `https://genesis.destatis.de`) |
| `--language <de\|en>` | response language (default `de`; English data labels are partial) |
| `--pagelength <n>` | max list results, `1..25000` (server default 100) |
| `--timeout <ms>` · `--max-retries <n>` · `--max-response-bytes <n>` | transport tuning |
| `--user-agent <ua>` | User-Agent header |
| `--compact` | single-line JSON |
| `-o, --output <file>` | write output (JSON, or a download) to a file instead of stdout |

## hello / logincheck

```bash
destatis hello           # helloworld/whoami — needs NO credentials
destatis logincheck      # helloworld/logincheck — validates your credentials
```

## find — full-text search

```bash
destatis find <term> [--category all|tables|statistics|cubes|variables|time-series]
```

`--pagelength` bounds the result count. Returns parallel arrays
(`Tables`/`Statistics`/`Cubes`/`Timeseries`/`Variables`), each `null` when not
searched.

```bash
destatis find "Bevölkerung" --category tables --pagelength 20
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

```bash
destatis data tablefile 12411-0001 --format ffcsv -o population.zip
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success (help/version included); also an **empty result** — see note |
| `1` | API/logical error, network or parse error |
| `2` | usage error (missing/partial credentials, bad flags/arguments, unknown command) |
| `4` | object not found — only the rare `Status.Code 90` / HTTP 404 (see note) |

> **A missing object code does not exit 4.** Looking up a code that does not exist
> on `metadata`/`data` returns `Status.Code 104` ("Es gibt keine Objekte zum
> angegebenen Selektionskriterium") — a valid **empty** result, so the CLI exits
> **0**, the same as an empty `catalogue`/`find` search. The `90 → 4` mapping is a
> defensive path the server rarely takes. To detect "no such object" in a script,
> inspect `Status.Code` in the payload, not the exit code.

## Gotchas

- **Too-large tables.** A table that is too big to return synchronously fails
  with `Status.Code 98`; this read-only CLI does not run the async batch-job
  flow. Narrow the request (`--start-year`/`--end-year`/`--timeslices`/`--class-key`)
  or download a subset via `data tablefile`.
- **Pagination.** GENESIS paginates by `--pagelength` only (no offset/cursor);
  narrow with `selection`/`term` rather than paging.
- **Transient upstream errors.** The GENESIS server is occasionally flaky: an
  individual `find` term or request can return a transient `HTTP 500` or time out,
  and the very same call usually succeeds moments later (the failure moves between
  terms over time — it is not tied to a specific word or to umlauts). Just retry,
  or raise `--timeout`. Note that only `429`/`503` are auto-retried (`--max-retries`),
  **not** `500` or timeouts. Where the server includes a message, the CLI now
  surfaces it in the error text.
- **`"boolean"`/count fields are strings.** List items encode e.g. `Values` /
  `Cubes` counts and flags as JSON strings (`"9"`, `"true"`).
- **Attribution.** Cite the `Copyright` field from each response — see
  [DATA_LICENSE.md](DATA_LICENSE.md).
