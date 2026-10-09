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
compatibility: >
  Requires the `destatis` CLI (npm package
  @maschinenlesbar.org/destatis-genesis-cli) on PATH, installed by the user; the
  skill never installs it. Uses jq for JSON filtering. Network access to
  genesis.destatis.de. find runs with an account or, asked for explicitly
  with --guest, as the GENESIS guest user; catalogue and metadata need a
  registered GENESIS account: --token or DESTATIS_API_TOKEN, or
  --username/--password or DESTATIS_USERNAME/DESTATIS_PASSWORD, or a
  stored login (destatis config set).
---

# DESTATIS Statistics Finder

Turn a topic into a concrete GENESIS object **code** (e.g. table `12411-0001`)
that later data commands can fetch. GENESIS is code-driven: you cannot pull data
until you know the code, and this skill is how you get there.

## Tooling

This skill drives the `destatis` command. **Before anything else, validate it is available** — run `command -v destatis` (or `destatis --version`). If it is not on your PATH, STOP and inform the user that the `destatis` CLI (`@maschinenlesbar.org/destatis-genesis-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

**Credentials are required** for everything except `destatis hello` and a guest `destatis find`. GENESIS needs a free registered account. Supply either an API token via `DESTATIS_API_TOKEN` (or `--token`), or a login via `DESTATIS_USERNAME` + `DESTATIS_PASSWORD` (or `--username`/`--password`), or stored once by the user with `destatis config set token` (or `username` and `password`: typed at a prompt without echo; never put a value on the command line yourself), which the CLI reads by itself when no flag and no variable gives a credential — one login only: a token together with a username or password, from flags or variables (or both stored), exits `2`; tell the user to unset one. There is **no bundled credential** — register at https://www-genesis.destatis.de. **Guest access is explicit, never a fallback.** Check whether credentials are set without printing them: `{ [ -n "${DESTATIS_API_TOKEN}${DESTATIS_USERNAME}${DESTATIS_PASSWORD}" ] || [ -n "$(destatis config list 2>/dev/null)" ]; } && echo set || echo unset` (`config list` prints stored names with masked values only). Only when that says `unset` and the user gave you no credentials, run a search as GENESIS's guest user `GAST` by passing `--guest` explicitly (`destatis --guest find …`), and say in your answer that it ran as guest. Never add `--guest` while credentials are set (exit `2`), and never switch to `--guest` on your own after a command with credentials failed. `--guest` covers `find` only: `catalogue`, `metadata`, `data` and `logincheck` refuse it (exit `2`) — stop and tell the user these need an account. A command run with neither credentials nor `--guest` exits `2` with guidance: stop and tell the user rather than retrying. **Wrong credentials exit `1`** with `GENESIS status 2 (ERROR) / HTTP 404 …` (or `/ HTTP 200`; missing or unrecognised ones: `GENESIS status 15 … / HTTP 401`; from `destatis logincheck`: `GENESIS login rejected (HTTP 200) …`) and an `INFO  [destatis.api] check your credentials` record on stderr — stop and tell the user to check the token or username/password; don't retry. Confirm access with `destatis logincheck`; if it exits `1` without that hint (`the login was not confirmed`), GENESIS's answer was neither a success nor a failure — tell the user, and treat the login as unconfirmed.

Pass `--compact` so each result is one line for `jq`. Add `--language en` for
English labels (partial). Cite the `Copyright` field from any response you show.

## Step 1 — Search by topic

```bash
destatis --compact find "Bevölkerung" --category tables --pagelength 20
# no credentials set (see above): ask for guest access explicitly
destatis --compact --guest find "Bevölkerung" --category tables --pagelength 20
```

- `--category` ∈ `all` · `tables` · `statistics` · `cubes` · `variables` ·
  `time-series`. Start with `tables` (the usable 2-D views); widen to `all` if
  nothing fits.
- `find` returns **parallel arrays** `Tables` / `Statistics` / `Cubes` /
  `Timeseries` / `Variables`, each `null` when that type was not searched **or
  nothing of that type matched**. Read the array that matches your category.

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
and which `--class-var1..5`/`--class-key1..5` filters exist.

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

- **Empty result ≠ error.** A `find` with no matches answers `Status.Code 0`
  ("erfolgreich") with the array for your category `null` — not `104`, and not an
  empty list. A `catalogue` with no matches answers `Status.Code 104` with an empty
  list. Both exit `0`: "nothing matched", not a failure. Broaden the term or
  category.
- **`find` arrays can be `null`.** Don't assume every array is present; a `null`
  array for your `--category` means no hits of that type.
- **A wrong code is not an error.** `metadata` on a code that does not exist
  exits `0` with `Status.Code 104` and no `Object` — check `Status.Code` before
  handing a code off.
- **Codes are exact.** `metadata`/`data` take a precise `name` (e.g.
  `12411-0001`), not a wildcard. Use `catalogue ... "124*"` to discover, then a
  full code to fetch.
- **`Values`/`Cubes` counts are strings** (`"9"`, not `9`) — don't do math on
  them without parsing.
- Don't guess an EVAS code from memory — always resolve it via `find`/`catalogue`.
