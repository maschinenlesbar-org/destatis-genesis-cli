---
name: destatis-data-fetch
description: >
  Fetch and interpret the actual numbers from a DESTATIS GENESIS table, cube or
  time series using the destatis-genesis-cli, then explain the returned CSV.
  Trigger when the user asks "get the population of Germany for 2023", "pull
  Destatis table 12411-0001", "how many births per Bundesland from GENESIS?",
  "fetch the GDP time series", or has an EVAS code and wants the values narrowed
  by year and region. Handles the year/region/classifying filters and decodes the
  ";"-delimited German-format CSV that arrives inside Object.Content.
version: 1.0.0
userInvocable: true
---

# DESTATIS Data Fetch

Pull statistical data for a known object **code** and turn the raw response into
readable numbers. GENESIS returns the table as a delimited CSV **string** inside
`Object.Content`, in German number format — the value of this skill is fetching
the right slice and decoding it correctly.

## Tooling

This skill drives the `destatis` command. **Before anything else, validate it is available** — run `command -v destatis` (or `destatis --version`). If it is not on your PATH, STOP and inform the user that the `destatis` CLI (`@maschinenlesbar.org/destatis-genesis-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**Credentials are required** for everything except `destatis hello`. GENESIS needs a free registered account. Supply either an API token via `DESTATIS_API_TOKEN` (or `--token`), or a login via `DESTATIS_USERNAME` + `DESTATIS_PASSWORD` (or `--username`/`--password`). There is **no bundled credential** — register at https://www-genesis.destatis.de. A command run without credentials exits `2` with guidance: stop and tell the user rather than retrying. Confirm access with `destatis logincheck`.

If you don't have the object code yet, resolve it first with
**destatis-statistics-finder**. Always cite the response `Copyright` field.

## Step 1 — Fetch the data, narrowed

```bash
destatis --compact data table 12411-0001 --start-year 2020 --end-year 2023
```

`data <kind> <name>` — `kind` ∈ `table` · `cube` · `timeseries` · `result`.
Narrow the request (both to answer precisely and to avoid the too-large error):

| Flag | Effect |
|---|---|
| `--start-year <YYYY>` · `--end-year <YYYY>` | limit the time range |
| `--timeslices <n>` | only the latest `n` periods |
| `--region-var <code>` · `--region-key <key>` | pick a regional dimension and region(s); `*` wildcard ok |
| `--class-var1..5 <code>` · `--class-key1..5 <key>` | filter a classifying variable to specific values |
| `--contents <labels>` | restrict to specific value columns |
| `--transpose` | swap rows/columns for readability |

Discover the valid `--class-var*` / `--region-var` codes from `metadata table
<name>` first.

## Step 2 — Decode `Object.Content`

The payload is a **`;`-delimited, newline-terminated CSV string** in German
locale:

- **Decimal comma, thousands dot** — `84.669.326` is ~84.7 million;
  `1.234,5` is 1234.5. Convert before doing arithmetic.
- **Value-status symbols** appear instead of numbers: `-` (none / nil), `.`
  (unknown or confidential), `...` (not yet available), `/` (not meaningful),
  `x` (not applicable), `()` (limited value), `p` (provisional), `r` (revised),
  `s` (estimated). Report these as-is; never coerce them to `0`.
- The leading lines are headers (statistic code, dimension labels); the data rows
  follow. Read the `Object.Structure` (add `--structure`) if you need the
  dimension tree to label columns.

## Step 3 — Report

Present the figures as a small table with a one-line source note. Keep the
original units and any status symbols.

```
Bevölkerung Deutschland (table 12411-0001), Stichtag 31.12.:
  2020  83.155.031
  2021  83.237.124
  2022  84.358.845
  2023  84.669.326
Source: Statistisches Bundesamt (Destatis), Genesis-Online; DL-DE-BY-2.0.
```

## Traps

- **HTTP 200 is not success.** The CLI already maps the logical `Status` for you:
  a real failure is a non-zero exit with a clear message. But if you inspect raw
  JSON, check `Status.Code` (`0`/`22` ok, `90` not found, `98` too large).
- **Too large (`Status.Code 98`, exit 1).** The table is too big for a direct
  fetch and this CLI does not run the async batch-job flow. **Narrow** with
  `--start-year`/`--end-year`/`--timeslices`/`--class-key`, or download a subset
  (hand off to **destatis-table-download**). Do not retry unchanged.
- **Not found is exit 4.** A wrong code → `Status.Code 90`. Re-resolve with the
  finder skill.
- **German number format** — always convert decimal-comma before math, and never
  silently drop value-status symbols.
- **Empty (`Status.Code 104`, exit 0)** means your filters excluded everything —
  loosen `--class-key`/year filters.
