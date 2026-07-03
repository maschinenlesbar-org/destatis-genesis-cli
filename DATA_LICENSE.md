# Data license

> **This tool does not include, host, or redistribute any data.**
> `destatis-genesis-cli` is a *client*. It only accesses data served live by the
> **Statistisches Bundesamt (Destatis)** via the GENESIS-Online API. That data is
> Destatis's and is governed by **their** terms, summarized below. The license of
> this CLI's own source code is a separate matter — see [LICENSING.md](LICENSING.md).

| | |
|---|---|
| **Data provider** | Statistisches Bundesamt (Destatis) |
| **API / source** | `https://www-genesis.destatis.de/genesisWS/rest/2020` · portal: https://www-genesis.destatis.de |
| **Data license** | **Datenlizenz Deutschland – Namensnennung – Version 2.0** (`DL-DE-BY-2.0`) |
| **License text** | https://www.govdata.de/dl-de/by-2-0 |
| **Attribution** | **Required** (provider name + `dl-de/by-2-0` reference). |
| **Commercial use** | **Allowed.** |
| **Redistribution / modification** | Allowed, with source attribution and changes marked. |

DL-DE-BY-2.0 is a permissive, attribution-only open-data license: no
share-alike, no non-commercial and no no-derivatives clauses. The only
obligations are to name the source and to mark any changes.

## Attribution

Quote the source label verbatim (English or German form):

```
Data source: Statistisches Bundesamt (Destatis), Genesis-Online; <date of retrieval>; Data licence by-2-0
Datenquelle: Statistisches Bundesamt (Destatis), Genesis-Online; <Abrufdatum>; Datenlizenz by-2-0
```

If you alter or recompute the figures, append `; own calculation` /
`; eigene Berechnung` (or `own representation` / `eigene Darstellung`).

**Prefer the API's own attribution.** Every `data/*` and `metadata/*` response
carries a `Copyright` field (e.g. `© Statistisches Bundesamt (Destatis), 2020;
Datenlizenz Deutschland – Namensnennung – Version 2.0`). Surface that value
**verbatim** rather than hardcoding a year — the API is the source of truth and
this CLI never rewrites it.

## Notes & caveats

- **A free registered account is required.** The "kostenfrei ohne Anmeldung"
  wording on the marketing pages refers to the *web UI*, not the API. Register at
  https://www-genesis.destatis.de and use a personal API token or your
  username/password (see [DEVELOPING.md](DEVELOPING.md) and [GLOSSARY.md](GLOSSARY.md)).
  Credentials are **personal** — never commit or share them.
- **Fair use.** GENESIS limits *concurrency* (roughly three parallel requests per
  account) rather than a published daily quota; Destatis may change limits at any
  time. Bulk/very large tables use an async batch-job flow this CLI does not
  implement (see DEVELOPING.md) — narrow your selection instead.
- **Sibling databases differ.** The same GENESIS software also powers
  Regionalstatistik (`regionalstatistik.de`) and the Zensus. If you point
  `--base-url` at one of those, the data terms may differ — rely on the
  per-response `Copyright` field for the actual host you queried.
- No warranty for accuracy; verify against the source for anything important.

## Sources

- https://www.govdata.de/dl-de/by-2-0 — DL-DE-BY-2.0 license text
- https://www-genesis.destatis.de — GENESIS-Online portal, registration and API docs

---

*Good-faith summary compiled 2026-07-03; not legal advice. The provider's terms
are authoritative and can change — verify at the source before relying on the
data, especially for any commercial or redistribution use.*
