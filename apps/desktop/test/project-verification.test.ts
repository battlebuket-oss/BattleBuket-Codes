import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverQualityScripts, runProjectQualityChecks } from "../src/main/project-verification";

test("discovers supported project scripts and honours the declared package manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "node -e \\"process.exit(0)\\"", lint: "node -e \\"process.exit(0)\\"" } }));
    const result = await discoverQualityScripts(root);
    assert.deepEqual(result, { manager: "pnpm", scripts: ["test", "lint"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not execute project scripts without explicit user approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \\"process.exit(0)\\"" } }));
    let asked = false;
    const results = await runProjectQualityChecks(root, async scripts => { asked = scripts.includes("test"); return false; });
    assert.equal(asked, true);
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, false);
    assert.match(results[0].output ?? "", /did not approve/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runs approved project scripts through the declared package manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \\"process.exit(0)\\"" } }));
    const results = await runProjectQualityChecks(root, async () => true);
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, true, results[0].output);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("enables high-severity dependency auditing when an npm lockfile exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(join(root, "package-lock.json"), "{}");
    const result = await discoverQualityScripts(root);
    assert.deepEqual(result, { manager: "npm", scripts: ["audit"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
