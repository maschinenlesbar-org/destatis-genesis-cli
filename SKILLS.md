# Skills

`destatis-genesis-cli` ships **Claude Code Agent Skills** as a plugin
marketplace, so Claude can drive the `destatis` CLI for common
official-statistics tasks. The skills **validate** that the `destatis` CLI is on
your PATH and tell you if it is missing — they never install anything.

| Skill | Use it when you want to… |
|---|---|
| **destatis-statistics-finder** | Turn a topic into a concrete GENESIS object code — search (`find`), browse by code (`catalogue`), and confirm structure (`metadata`). |
| **destatis-data-fetch** | Pull the actual numbers for a known code and decode the German-format CSV in `Object.Content` (with year/region/classifying filters). |
| **destatis-table-download** | Export a table/cube/time series to a file (CSV, tidy `ffcsv`, Excel, …) via the `data/*file` endpoints. |

They compose: **finder → data-fetch** (or **→ table-download**).

## Requirements

- The `destatis` CLI on PATH: `npm install -g @maschinenlesbar.org/destatis-genesis-cli`.
- **Credentials** (except `destatis hello`): a free GENESIS account. Set
  `DESTATIS_API_TOKEN`, or `DESTATIS_USERNAME` + `DESTATIS_PASSWORD`. Register at
  https://www-genesis.destatis.de. No credential is bundled.

## Installing the plugin

This repo is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`
+ `.claude-plugin/plugin.json` + `skills/`). Add it as a marketplace in Claude
Code to enable the three skills. The `skills/` and `.claude-plugin/` files are
**not** shipped in the npm tarball — the published package is the client/CLI
only.

The data these skills surface is Destatis's, under DL-DE-BY-2.0 — see
[DATA_LICENSE.md](DATA_LICENSE.md). Cite the `Copyright` field from each response.
