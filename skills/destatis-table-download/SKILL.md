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
version: 1.0.0
userInvocable: true
---

# DESTATIS Table Download

Save a GENESIS object as a file for spreadsheets or archiving, instead of
printing JSON. The `data/*file` endpoints return a server-rendered **ZIP**; this
skill writes those bytes to disk and tells the user exactly what landed.

## Tooling

This skill drives the `destatis` command. **Before anything else, validate it is available** — run `command -v destatis` (or `destatis --version`). If it is not on your PATH, STOP and inform the user that the `destatis` CLI (`@maschinenlesbar.org/destatis-genesis-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**Credentials are required** for everything except `destatis hello`. GENESIS needs a free registered account. Supply either an API token via `DESTATIS_API_TOKEN` (or `--token`), or a login via `DESTATIS_USERNAME` + `DESTATIS_PASSWORD` (or `--username`/`--password`). There is **no bundled credential** — register at https://www-genesis.destatis.de. A command run without credentials exits `2` with guidance: stop and tell the user rather than retrying. Confirm access with `destatis logincheck`.

Resolve the object code with **destatis-statistics-finder** first if you don't
have it. Cite the response's `Copyright` for attribution (DL-DE-BY-2.0).

## Step 1 — Choose the output path (confirm before writing)

Pick a concrete path and **confirm it with the user**, and **avoid clobbering an
existing file** — if the target exists, ask before overwriting or choose a new
name. The download is a ZIP, so use a `.zip` extension.

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

The CLI prints a stderr confirmation like
`Wrote 40213 bytes to population.zip (Content-Type: application/zip)`. Relay that
to the user: the **path**, the **byte count**, and the **format**. If the byte
count is suspiciously small (a few hundred bytes), the "download" may actually be
a JSON error the CLI surfaced — check the exit code and re-read the message.

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
- **Not found is exit 4** (`Status.Code 90`) — re-check the code.
- **Confirm the path and don't silently overwrite** — this skill writes to the
  user's filesystem.
- A tiny output file usually means an error envelope was returned instead of the
  ZIP — verify before telling the user it succeeded.
