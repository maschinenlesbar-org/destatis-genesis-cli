# Glossary

GENESIS-Online concepts and the vocabulary this CLI exposes. GENESIS is a
multidimensional statistics database: **statistics** are made of **cubes**, which
are sliced into **tables**, described by **variables** and their **values**.

## Objects

| Term | GENESIS | Meaning |
|---|---|---|
| **Statistic** (Statistik) | `statistic` | A whole statistical product, keyed by a 5-digit EVAS code (e.g. `12411`, "Fortschreibung des Bevölkerungsstandes"). Contains cubes. |
| **Table** (Tabelle) | `table` | A ready-made 2-D view, keyed like `12411-0001`. The main thing you fetch. |
| **Cube** (Datenquader) | `cube` | The raw multidimensional data behind tables, keyed like `12411BJ001`. |
| **Time series** (Zeitreihe) | `timeseries` | A cube reduced to a single value over time. |
| **Variable** (Merkmal) | `variable` | A dimension/attribute (e.g. `DLAND` = Bundesland, `NAT` = nationality). |
| **Value** (Ausprägung) | `value` | A concrete value of a variable (e.g. a specific Bundesland). |
| **Result** (Ergebnistabelle) | `result` | A table produced by an async job, saved in your user area. |

## Codes & selection

- **EVAS code** — the numeric object key. `12` (subject area) → `12411`
  (statistic) → `12411-0001` (table) / `12411BJ001` (cube).
- **`selection`** — a code filter for `catalogue` browsing; supports a `*`
  wildcard, e.g. `124*` matches all objects whose code starts `124`.
- **`name`** — the exact object code passed to `metadata`/`data`.
- **`classifyingvariable{n}` / `classifyingkey{n}`** — restrict a `data` request
  to specific variable values (the "key" selects values, `*` wildcard allowed).
- **`regionalvariable` / `regionalkey`** — the regional dimension and the
  region(s) to include (e.g. a Land or Kreis code).

## The response envelope

Every non-`helloworld` response is wrapped:

| Field | Meaning |
|---|---|
| `Ident` | `{ Service, Method }` — which endpoint answered. |
| `Status` | `{ Code, Content, Type }` — the **logical** outcome (see below). |
| `Parameter` | echo of your request (credentials masked as `********`). |
| `Copyright` | the attribution string to cite — see [DATA_LICENSE.md](DATA_LICENSE.md). |
| `List` | catalogue results (a homogeneous array). |
| `Object` | data/metadata payload (opaque; for `data/table`, a CSV string in `Object.Content`). |

`helloworld/whoami` and `helloworld/logincheck` do **not** use this envelope.

## `Status.Code` values

HTTP is almost always `200`; the real outcome is `Status.Code`:

| Code | Type | Meaning | This CLI |
|---|---|---|---|
| `0` | Information | success | returns data |
| `22` | Warnung | success, a parameter was auto-corrected | returns data (warning visible in `Status.Content`) |
| `50` | Information | no newer data (for `--stand`) | returns data |
| `104` | Information | no object matched | returns an **empty** result (exit 0) |
| `90` | Fehler | requested object not found | error, **exit 4** |
| `98` | Information | result too large for a direct fetch | error with narrowing guidance, exit 1 |
| any | Fehler / Error | general error | error, exit 1 |

## Value-status placeholders

In a `data/table` CSV, a cell may be a status symbol instead of a number:
`-` (nothing to report / genuine zero context), `.` (unknown/secret), `...`
(not yet available), `/` (not meaningful), `x` (not applicable), `()` (limited
informative value), `p` (provisional), `r` (revised), `s` (estimated).

## Auth terms

- **API token** — a 32-char personal token generated in the GENESIS web UI
  ("Webservice/API"). Placed in the `username` request field with no password.
  Generating a new token invalidates the old one.
- **Username / password** — the account login (username ~10 chars, may be an
  email; password 10–50 chars). Required together.

See [DEVELOPING.md](DEVELOPING.md) for how credentials are passed on the wire and
why redirects are not followed.
