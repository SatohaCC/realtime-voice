import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const biome = path.join(frontend, "node_modules/@biomejs/biome/bin/biome");
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "biome-policy-"));
copyFileSync(path.join(frontend, "biome.json"), path.join(fixtureRoot, "biome.json"));
copyFileSync(path.join(frontend, "package.json"), path.join(fixtureRoot, "package.json"));

after(() => {
  // このテスト専用に作成した一時ディレクトリだけを削除する。
  assert.equal(path.dirname(fixtureRoot), os.tmpdir());
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function runBiome(args: string[], source: string, file = "src/features/biome-policy-fixture.tsx") {
  const filename = path.join(fixtureRoot, file);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, source);
  const result = spawnSync(process.execPath, [biome, ...args, file], {
    cwd: fixtureRoot,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, null, result.stderr);
  return { status: result.status, output: result.stdout + result.stderr };
}

const syntaxCases = [
  {
    rule: "suspicious/noExplicitAny",
    invalid: "export type Value = any;",
    valid: "export type Value = unknown;",
  },
  {
    rule: "style/noNonNullAssertion",
    invalid: "export function read(value?: string) { return value!; }",
    valid: 'export function read(value?: string) { return value ?? ""; }',
  },
  {
    rule: "style/useConsistentArrayType",
    invalid: "export type Values = Array<string>;",
    valid: "export type Values = readonly string[];",
  },
  {
    rule: "style/useImportType",
    invalid:
      'import { type ReactNode, useState } from "react"; export { useState }; export type Node = ReactNode;',
    valid:
      'import type { ReactNode } from "react"; import { useState } from "react"; export { useState }; export type Node = ReactNode;',
  },
  {
    rule: "correctness/useHookAtTopLevel",
    invalid:
      'import { useState } from "react"; export function Example({ enabled }: { enabled: boolean }) { if (enabled) { useState(0); } return null; }',
    valid:
      'import { useState } from "react"; export function Example() { useState(0); return null; }',
  },
  {
    rule: "correctness/useExhaustiveDependencies",
    invalid:
      'import { useEffect } from "react"; export function Example({ text }: { text: string }) { useEffect(() => { document.title = text; }, []); return null; }',
    valid:
      'import { useEffect } from "react"; export function Example({ text }: { text: string }) { useEffect(() => { document.title = text; }, [text]); return null; }',
  },
];

for (const { rule, invalid, valid } of syntaxCases) {
  test(`Biome が ${rule} の違反を拒否し、修正例を許可する`, () => {
    const rejected = runBiome(["lint"], invalid);
    assert.equal(rejected.status, 1, rejected.output);
    assert.ok(rejected.output.includes(`lint/${rule}`), rejected.output);
    const accepted = runBiome(["lint"], valid);
    assert.equal(accepted.status, 0, accepted.output);
  });
}

for (const layer of ["ui", "components"]) {
  for (const dependency of [
    "@/features/audio/useDualMicAudio",
    "../../../features/audio/useDualMicAudio",
    "../../../app/page",
    "@/shared/lib/supabase/client",
    "../../lib/supabase/client",
    "@supabase/supabase-js",
    "@tanstack/react-query",
    "next/navigation",
  ]) {
    test(`${layer} から ${dependency} の import を拒否する`, () => {
      const result = runBiome(
        ["lint"],
        `import * as dependency from "${dependency}"; export { dependency };`,
        `src/shared/${layer}/biome-policy-fixture.tsx`,
      );
      assert.equal(result.status, 1, result.output);
      assert.ok(result.output.includes("lint/style/noRestrictedImports"), result.output);
    });
  }
}

test("共有 UI の正規の依存先は許可する", () => {
  for (const [file, dependency] of [
    ["src/shared/ui/biome-policy-fixture.tsx", "@ui-sdk/react/button"],
    ["src/shared/components/biome-policy-fixture.tsx", "@/shared/ui"],
    ["src/shared/components/biome-policy-fixture.styles.ts", "../../styles/tokens.stylex"],
  ]) {
    const result = runBiome(
      ["lint"],
      `import * as dependency from "${dependency}"; export { dependency };`,
      file,
    );
    assert.equal(result.status, 0, result.output);
  }
});

test("実際の lint コマンドが警告だけでも失敗する", () => {
  const manifest = JSON.parse(readFileSync(path.join(frontend, "package.json"), "utf8"));
  const [command, ...args] = manifest.scripts.lint.split(" ") as string[];
  assert.equal(command, "biome");
  const source = "const unused = 1;\n";
  const warning = runBiome(["check"], source);
  assert.equal(warning.status, 0, warning.output);
  assert.ok(warning.output.includes("lint/correctness/noUnusedVariables"), warning.output);
  const rejected = runBiome(
    args.filter((arg) => arg !== "."),
    source,
  );
  assert.equal(rejected.status, 1, rejected.output);
  assert.ok(rejected.output.includes("lint/correctness/noUnusedVariables"), rejected.output);
});
