// find service: full-text search across every GENESIS object type.

import { Option, type Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, commonListParams, parseNonEmpty, renderJson } from "../shared.js";
import type { FindCategory } from "../../client/params.js";

const CATEGORIES = ["all", "tables", "statistics", "cubes", "variables", "time-series"] as const;

export function registerFindCommand(program: Command, deps: CliDeps): void {
  program
    .command("find")
    .description(
      "Full-text search across statistics, tables, cubes, variables and time series " +
        "(works without credentials, as the GENESIS guest user)",
    )
    .argument("<term>", "search term (must be non-empty)", parseNonEmpty)
    .addOption(
      new Option("--category <cat>", "restrict to an object type").choices([...CATEGORIES]).default("all"),
    )
    .action(
      action(
        deps,
        async ({ client, global, opts }, [term]) => {
          renderJson(
            deps,
            global,
            await client.find({
              term: term!,
              category: opts["category"] as FindCategory,
              ...commonListParams(global),
            }),
          );
        },
        // GENESIS serves find/find to anonymous callers as the guest user "GAST"
        // (verified live 2026-09-26), so credentials are optional here: sent when
        // configured, not demanded when absent.
        { auth: false },
      ),
    );
}
