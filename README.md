# destatis-genesis-cli

A TypeScript **API client and CLI** for the **DESTATIS GENESIS-Online REST API**
(version 2020) — the German Federal Statistical Office's official-statistics
database at [www-genesis.destatis.de](https://www-genesis.destatis.de).

Search the catalogue, read object metadata, and pull statistical tables, cubes
and time series from the command line or as a library. Read-only, zero runtime
HTTP dependencies (built on `node:http`/`https`), strict TypeScript, ESM.

```bash
npm install -g @maschinenlesbar.org/destatis-genesis-cli
```

## Credentials

GENESIS needs a **free registered account** — register at
[www-genesis.destatis.de](https://www-genesis.destatis.de). Authenticate with
**either** a personal **API token** *or* your **username + password**. No
credential is bundled with this tool.

| How | Flag | Env var |
|-----|------|---------|
| Token (recommended) | `--token <t>` | `DESTATIS_API_TOKEN` |
| Username + password | `--username <u>` / `--password <p>` | `DESTATIS_USERNAME` / `DESTATIS_PASSWORD` |

Precedence per field is **flag > env var > unset**; a token takes precedence over
username/password. Only `destatis hello` works without credentials.

> **Prefer the environment variables.** A credential passed as a `--token` /
> `--username` / `--password` **flag** is visible in the process table (`ps`,
> `/proc`) to other local users and is persisted in your shell history — the
> account *password* is especially sensitive. The CLI prints a one-line stderr
> warning when it detects a flag-supplied credential. Set the env var instead; it
> takes effect whenever the corresponding flag is absent.

```bash
export DESTATIS_API_TOKEN="your-32-char-token"
```

## Quickstart

```bash
destatis hello                                  # connectivity check (no auth)
destatis logincheck                             # validate your credentials
destatis find "Bevölkerung" --category tables   # search for tables
destatis catalogue tables "124*"                # browse tables by code
destatis metadata table 12411-0001              # describe a table
destatis data table 12411-0001 --start-year 2020 --compact
destatis data tablefile 12411-0001 --format ffcsv -o pop.zip
```

Every command prints the API's JSON envelope (including the `Copyright`
attribution and a `Status` object). See **[Usage.md](Usage.md)** for the full
command reference and **[GLOSSARY.md](GLOSSARY.md)** for GENESIS concepts (EVAS
codes, cubes, `selection` wildcards, `Status.Code` values).

## Library use

```ts
import { DestatisClient } from "@maschinenlesbar.org/destatis-genesis-cli";

const genesis = new DestatisClient({ token: process.env.DESTATIS_API_TOKEN });
const hits = await genesis.find({ term: "Bevölkerung", category: "tables" });
const table = await genesis.data.table("12411-0001", { startyear: "2020" });
// table.Object.Content is the table as a ";"-delimited CSV string.
```

The client is usable independently of the CLI. Errors are typed
(`DestatisApiError`, `DestatisNetworkError`, `DestatisParseError`,
`DestatisUsageError`).

## Notes

- **HTTP 200 ≠ success.** GENESIS reports logical outcomes in a `Status` object in
  the body; this client inspects `Status.Code` and raises `DestatisApiError` for
  real errors (see [DEVELOPING.md](DEVELOPING.md)).
- **The data is Destatis's, not ours** — governed by DL-DE-BY-2.0. See
  **[DATA_LICENSE.md](DATA_LICENSE.md)**.
- **Code license:** AGPL-3.0-or-later **OR** commercial — see
  [LICENSING.md](LICENSING.md). External code contributions are not accepted
  ([CONTRIBUTING.md](CONTRIBUTING.md)); bug reports and forks are welcome.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # builds, then runs node --test on dist/test
npm run typecheck
```

See [DEVELOPING.md](DEVELOPING.md) for architecture and API specifics.
