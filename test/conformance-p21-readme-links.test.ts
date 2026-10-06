// Conformance test P21 (follow-up round 2026-10-06): the README ships in the npm tarball and
// is shown on npmjs.com, so a relative link in it must point to a file the package ships —
// anything else 404s there. Documents the package doesn't ship are linked by their absolute
// GitHub URL instead. "Shipped" is read from package.json `files` (plain paths and `dir/`
// prefixes; `!` negations don't add anything) plus what npm always packs (README, LICENSE*,
// package.json). Dependency-free: no `npm pack` here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The repository root, from the compiled location dist/test/.
const ROOT = new URL("../../", import.meta.url);
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, ROOT)), "utf8");

const GITHUB_BLOB = "https://github.com/maschinenlesbar-org/destatis-genesis-cli/blob/main/";

/** Relative markdown link targets in `markdown` (no scheme, no mailto, no in-page anchor). */
function relativeTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    targets.push(target);
  }
  return targets;
}

/** Whether npm packs `path`, given the `files` allowlist. */
function shipped(path: string, files: readonly string[]): boolean {
  const clean = path.replace(/^\.\//, "");
  if (/^(README|LICEN[CS]E)(\.[^/]*)?$/i.test(clean) || clean === "package.json") return true;
  return files.some((entry) => {
    if (entry.startsWith("!")) return false;
    const e = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    return clean === e || clean.startsWith(`${e}/`);
  });
}

test("P21: every relative README link points to a file the npm package ships", () => {
  const pkg = JSON.parse(read("package.json")) as { files?: string[] };
  const files = pkg.files ?? [];
  const targets = relativeTargets(read("README.md"));
  const bad = targets.filter((t) => !shipped(t.replace(/#.*$/, ""), files));
  assert.deepEqual(
    bad,
    [],
    `README links to files the npm package doesn't ship (404 on npmjs.com); link them as ${GITHUB_BLOB}<path>:\n` +
      bad.map((t) => `  ${t} -> ${GITHUB_BLOB}${t.replace(/^\.\//, "")}`).join("\n"),
  );
});

test("P21: the shipped-file rule itself", () => {
  const files = ["dist/src", "!dist/src/**/*.map", "LICENSING.md"];
  assert.equal(shipped("LICENSING.md", files), true);
  assert.equal(shipped("README.md", files), true);
  assert.equal(shipped("LICENSE", files), true);
  assert.equal(shipped("dist/src/index.js", files), true);
  assert.equal(shipped("Usage.md", files), false);
  assert.equal(shipped("skills/x/SKILL.md", files), false);
  assert.deepEqual(relativeTargets("[a](Usage.md#x) [b](https://x.y/) [c](#top) [d](mailto:a@b) [e](./SKILLS.md)"), [
    "Usage.md#x",
    "./SKILLS.md",
  ]);
});
