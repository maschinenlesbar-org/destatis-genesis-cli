// Compile-time checks of the exported library types, and the runtime rule they describe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DestatisClient } from "../src/index.js";
import { jsonResponse, makeMockTransport, bodyOf } from "./helpers.js";
import * as fx from "./fixtures.js";

// Runs the TypeScript compiler over a consumer file.
const STARTS_A_PROCESS = { timeout: 30_000 };
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("a consumer with the strictest compiler settings can pass undefined for any option", STARTS_A_PROCESS, async () => {
  // Under exactOptionalPropertyTypes, `{ token: process.env.DESTATIS_API_TOKEN }` fails to compile
  // against an option declared `?: string`, although the runtime treats undefined as omitted.
  const dir = mkdtempSync(join(tmpdir(), "destatis-genesis-types-"));
  try {
    writeFileSync(
      join(dir, "use.ts"),
      [
        `import { DestatisClient, type DestatisClientOptions, type EngineOptions, type FindParams, type CatalogueParams,`,
        `  type MetadataParams, type DataTableParams, type DataFileParams, type ParamOptions } from ${JSON.stringify(INDEX)};`,
        "declare function allUndefined<T>(): { [K in keyof T]-?: undefined };",
        "export const engine: EngineOptions = allUndefined<EngineOptions>();",
        "export const client: DestatisClientOptions = allUndefined<DestatisClientOptions>();",
        'export const find: FindParams = { term: "x", ...allUndefined<Omit<FindParams, "term">>() };',
        "export const catalogue: CatalogueParams = allUndefined<CatalogueParams>();",
        "export const metadata: MetadataParams = allUndefined<MetadataParams>();",
        "export const data: DataTableParams = allUndefined<DataTableParams>();",
        "export const file: DataFileParams = allUndefined<DataFileParams>();",
        "export const options: ParamOptions = allUndefined<ParamOptions>();",
        "export const c = new DestatisClient({ token: process.env.DESTATIS_API_TOKEN, baseUrl: process.env.DESTATIS_BASE_URL, timeoutMs: 15_000 });",
        "export const tables = async (): Promise<unknown> => c.catalogue.tables({ selection: process.env.SELECTION });",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
          typeRoots: [join(ROOT, "node_modules/@types")],
        },
        files: ["use.ts"],
      }),
    );
    const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout + stderr }),
      );
    });
    assert.equal(result.code, 0, result.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an option or parameter given as undefined means its default, as an omitted one does", async () => {
  const mt = makeMockTransport(() => jsonResponse(fx.tablesList));
  const client = new DestatisClient({
    token: "TOKEN",
    username: undefined,
    password: undefined,
    guest: undefined,
    baseUrl: undefined,
    transport: mt.transport,
    userAgent: undefined,
    defaultHeaders: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    retryDelayMs: undefined,
    maxResponseBytes: undefined,
    sleep: undefined,
    onRetry: undefined,
  });
  await client.catalogue.tables(
    { selection: undefined, area: undefined, searchcriterion: undefined, sortcriterion: undefined, type: undefined, pagelength: undefined, language: undefined },
    { allowUnknownParams: undefined },
  );
  const req = mt.last();
  assert.equal(req.url, "https://genesis.destatis.de/genesisWS/rest/2020/catalogue/tables");
  assert.equal(req.headers?.["User-Agent"], "destatis-genesis-cli");
  assert.equal(req.headers?.["username"], "TOKEN");
  assert.equal(bodyOf(req).toString(), "");
  await client.find({ term: "x", category: undefined, pagelength: undefined, language: undefined });
  assert.equal(bodyOf(mt.last()).toString(), "term=x");
  await client.data.table("12411-0001", { startyear: undefined, regionalkey: undefined, timeslices: undefined, compress: undefined });
  assert.equal(bodyOf(mt.last()).toString(), "name=12411-0001");
  // A guest client with every credential undefined.
  const guest = new DestatisClient({ guest: true, token: undefined, username: undefined, password: undefined, transport: mt.transport });
  await guest.find({ term: "y" });
  assert.equal(mt.last().headers?.["username"], undefined);
});
