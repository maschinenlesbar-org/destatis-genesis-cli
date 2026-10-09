---
name: destatis-table-download
description: >
  Export a DESTATIS GENESIS table, cube, time series or saved result to a file
  (CSV, flat "ffcsv", Excel, HTML or GENML) using the destatis-genesis-cli.
  Trigger when the user asks "download Destatis table 12411-0001 as CSV", "save
  the population data to Excel", "export the GENESIS time series to a file", or
  wants a spreadsheet-ready file rather than JSON in the terminal. Writes the
  server-rendered download (a ZIP) to a path you confirm, and reports what was
  written.
compatibility: >
  Requires the `destatis` CLI (npm package
  @maschinenlesbar.org/destatis-genesis-cli) on PATH, installed by the user; the
  skill never installs it. Network access to genesis.destatis.de. Needs a
  registered GENESIS account: --token or DESTATIS_API_TOKEN, or
  --username/--password or DESTATIS_USERNAME/DESTATIS_PASSWORD, or a
  stored login (destatis config set).
---

# DESTATIS Table Download

Save a GENESIS object as a file for spreadsheets or archiving, instead of
printing JSON. The `data/*file` endpoints return a server-rendered **ZIP**; this
skill writes those bytes to disk and tells the user exactly what landed.

## Tooling

This skill drives the `destatis` command. **Before anything else, validate it is available** — run `command -v destatis` (or `destatis --version`). If it is not on your PATH, STOP and inform the user that the `destatis` CLI (`@maschinenlesbar.org/destatis-genesis-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**Credentials are required** for everything except `destatis hello` and a guest `destatis find`. GENESIS needs a free registered account. Supply either an API token via `DESTATIS_API_TOKEN` (or `--token`), or a login via `DESTATIS_USERNAME` + `DESTATIS_PASSWORD` (or `--username`/`--password`), or stored once by the user with `destatis config set token` (or `username` and `password`: typed at a prompt without echo; never put a value on the command line yourself), which the CLI reads by itself when no flag and no variable gives a credential — one login only: a token together with a username or password, from flags or variables (or both stored), exits `2`; tell the user to unset one. There is **no bundled credential** — register at https://www-genesis.destatis.de. **Guest access is explicit, never a fallback.** Check whether credentials are set without printing them: `{ [ -n "${DESTATIS_API_TOKEN}${DESTATIS_USERNAME}${DESTATIS_PASSWORD}" ] || [ -n "$(destatis config list 2>/dev/null)" ]; } && echo set || echo unset` (`config list` prints stored names with masked values only). Only when that says `unset` and the user gave you no credentials, run a search as GENESIS's guest user `GAST` by passing `--guest` explicitly (`destatis --guest find …`), and say in your answer that it ran as guest. Never add `--guest` while credentials are set (exit `2`), and never switch to `--guest` on your own after a command with credentials failed. `--guest` covers `find` only: `catalogue`, `metadata`, `data` and `logincheck` refuse it (exit `2`) — stop and tell the user these need an account. A command run with neither credentials nor `--guest` exits `2` with guidance: stop and tell the user rather than retrying. **Wrong credentials exit `1`** with `GENESIS status 2 (ERROR) / HTTP 404 …` (or `/ HTTP 200`; missing or unrecognised ones: `GENESIS status 15 … / HTTP 401`; from `destatis logincheck`: `GENESIS login rejected (HTTP 200) …`) and an `INFO  [destatis.api] check your credentials` record on stderr — stop and tell the user to check the token or username/password; don't retry. Confirm access with `destatis logincheck`; if it exits `1` without that hint (`the login was not confirmed`), GENESIS's answer was neither a success nor a failure — tell the user, and treat the login as unconfirmed.

Resolve the object code with **destatis-statistics-finder** first if you don't
have it. Cite the response's `Copyright` for attribution (DL-DE-BY-2.0).

## Step 1 — Choose the output path (confirm before writing)

Pick a concrete path and **confirm it with the user**, and **avoid clobbering an
existing file** — if the target exists, ask before overwriting or choose a new
name. The CLI itself refuses an existing `-o` target (exit `2`, "Refusing to
overwrite existing file") unless `--force` is passed, so add `--force` only after
the user has agreed to overwrite. The download is a ZIP, so use a `.zip` extension.

## Step 2 — Download

```bash
destatis data tablefile 12411-0001 --format ffcsv --start-year 2015 -o population.zip
```

`data <kind>file <name>` — `kind` ∈ `table` · `cube` · `timeseries` · `result`.
The **same** selection filters as `data <kind>` apply
(`--start-year`/`--end-year`/`--class-var*`/`--class-key*`/`--region-*`), so
narrow the export the same way.

Formats (`--format`):

| Format | Use |
|---|---|
| `datencsv` (default) | GENESIS CSV, German layout |
| `ffcsv` | **flat/tidy CSV, English headers** — best for data tools |
| `csv` | plain CSV |
| `xlsx` | Excel workbook |
| `html` | HTML table |
| `genml` | GENESIS XML |

**Always pass `-o <file>`** — without it the raw ZIP bytes go to stdout and will
scramble the terminal.

## Step 3 — Report what was written

The CLI logs a confirmation on stderr like
`… INFO  [destatis.output] Wrote 40213 bytes to population.zip (Content-Type: application/zip)`. Relay that
to the user: the **path**, the **byte count**, and the **format**. Report success
only on exit `0`: when GENESIS sends a status reply instead of the file, the CLI
writes nothing, prints the `GENESIS status …` message and exits non-zero.

```
Wrote population.zip — 40,213 bytes, ffcsv (zipped).
Contents: table 12411-0001, 2015–2023. Source: Destatis Genesis-Online, DL-DE-BY-2.0.
Unzip with: unzip population.zip
```

## Traps

- **It's a ZIP, not raw CSV.** Every `*file` format is delivered zipped; the
  file needs unzipping. Don't promise a directly-openable `.csv`.
- **Never omit `-o`** for a download — binary to a terminal is a mess.
- **Too large (`Status.Code 98`, exit 1)** still applies to `*file` on very large
  tables — narrow the selection; the async job flow is not supported.
- **Not found is exit 4.** A code that does not exist comes back as
  `GENESIS status 104 … the server sent this status instead of a file` (rarely
  `Status.Code 90`) and nothing is written — re-resolve the code with
  **destatis-statistics-finder**.
- **Confirm the path and don't silently overwrite** — this skill writes to the
  user's filesystem; the CLI refuses existing targets without `--force`.
