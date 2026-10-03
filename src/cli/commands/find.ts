// find service: full-text search across every GENESIS object type.

import { Option, type Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, commonListParams, parseNonEmpty, renderJson } from "../shared.js";
import { FIND_CATEGORIES, type FindCategory } from "../../client/params.js";

export function registerFindCommand(program: Command, deps: CliDeps): void {
  program
    .command("find")
    .description(
      "Full-text search across statistics, tables, cubes, variables and time series " +
        "(works without credentials, as the GENESIS guest user)",
    )
    .argument("<term>", "search term (must be non-empty)", parseNonEmpty)
    .addOption(
      // No .default(): an omitted --category is not sent, exactly like the library,
      // and GENESIS searches every object type.
      new Option("--category <cat>", "restrict to an object type (server default: all)").choices([
        ...FIND_CATEGORIES,
      ]),
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
              ...(opts["category"] !== undefined ? { category: opts["category"] as FindCategory } : {}),
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
