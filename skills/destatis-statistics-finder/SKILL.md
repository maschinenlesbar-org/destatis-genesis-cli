---
name: destatis-statistics-finder
description: >
  Find the right German official-statistics object (table, statistic, cube or
  time series) in the DESTATIS GENESIS database using the destatis-genesis-cli.
  Trigger when the user asks "which Destatis table has population by Bundesland?",
  "find official statistics on unemployment", "what's the EVAS code for GDP?",
  "search GENESIS for CO2 emissions data", or needs to turn a topic into a
  concrete object code before pulling numbers. Searches with find, narrows with
  catalogue, and confirms the structure with metadata — handing back the exact
  code to fetch.
version: 1.0.0
userInvocable: true
---

# DESTATIS Statistics Finder

Turn a topic into a concrete GENESIS object **code** (e.g. table `12411-0001`)
that later data commands can fetch. GENESIS is code-driven: you cannot pull data
until you know the code, and this skill is how you get there.

## Tooling

This skill drives the `destatis` command. **Before anything else, validate it is available** — run `command -v destatis` (or `destatis --version`). If it is not on your PATH, STOP and inform the user that the `destatis` CLI (`@maschinenlesbar.org/destatis-genesis-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**Credentials are required** for everything except `destatis hello`. GENESIS needs a free registered account. Supply either an API token via `DESTATIS_API_TOKEN` (or `--token`), or a login via `DESTATIS_USERNAME` + `DESTATIS_PASSWORD` (or `--username`/`--password`). There is **no bundled credential** — register at https://www-genesis.destatis.de. A command run without credentials exits `2` with guidance: stop and tell the user rather than retrying. Confirm access with `destatis logincheck`.

Pass `--compact` so each result is one line for `jq`. Add `--language en` for
English labels (partial). Cite the `Copyright` field from any response you show.

## Step 1 — Search by topic

```bash
destatis --compact find "Bevölkerung" --category tables --pagelength 20
```

- `--category` ∈ `all` · `tables` · `statistics` · `cubes` · `variables` ·
  `time-series`. Start with `tables` (the usable 2-D views); widen to `all` if
  nothing fits.
- `find` returns **parallel arrays** `Tables` / `Statistics` / `Cubes` /
  `Timeseries` / `Variables`, each `null` when not searched. Read the array that
  matches your category.

Each item: `Code` (the EVAS code you want) and `Content` (its German title).

## Step 2 — Narrow by code with `catalogue`

Once you know the subject-area prefix, browse by code with a `*` wildcard:

```bash
destatis --compact catalogue tables "12411*"
destatis --compact catalogue statistics "124*" --sort-criterion Content
```

Subcommands: `tables` · `statistics` · `cubes` · `timeseries` · `variables` ·
`values`. EVAS structure: `12` (area) → `12411` (statistic) → `12411-0001`
(table). This is the reliable way to enumerate all tables of a statistic.

## Step 3 — Confirm structure with `metadata`

Before handing off a code, check it is the right shape:

```bash
destatis --compact metadata table 12411-0001
```

`metadata <kind> <name>` (`kind` ∈ table/statistic/cube/timeseries/variable/value)
returns an `Object` describing the object's dimensions (`variable`s) and value
ranges — so you can tell the user *what breakdowns and years* the table offers
and which `--class-var`/`--class-key` filters exist.

## Step 4 — Report

Give the user the **code**, its title, and (from metadata) the available
dimensions and time span, then offer to fetch the data (hand off to
**destatis-data-fetch**) or download a file (**destatis-table-download**).

```
Match: table 12411-0001 — "Bevölkerung: Deutschland, Stichtag"
  Statistic: 12411 (Fortschreibung des Bevölkerungsstandes)
  Dimensions: Stichtag (time), Deutschland (region)
  → fetch with: destatis data table 12411-0001
```

## Traps

- **Empty result ≠ error.** A search/catalogue with no matches comes back with
  `Status.Code 104` and exits `0` (an empty list) — it means "nothing matched",
  not a failure. Broaden the term or category.
- **`find` arrays can be `null`.** Don't assume every array is present; read the
  one for your `--category`.
- **Codes are exact.** `metadata`/`data` take a precise `name` (e.g.
  `12411-0001`), not a wildcard. Use `catalogue ... "124*"` to discover, then a
  full code to fetch.
- **`Values`/`Cubes` counts are strings** (`"9"`, not `9`) — don't do math on
  them without parsing.
- Don't guess an EVAS code from memory — always resolve it via `find`/`catalogue`.
