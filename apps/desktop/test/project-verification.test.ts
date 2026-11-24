import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverQualityScripts, qualityCommand, runProjectQualityChecks } from "../src/main/project-verification";

test("discovers supported project scripts and honours the declared package manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "echo quality-ok", lint: "echo quality-ok" } }));
    const result = await discoverQualityScripts(root);
    assert.deepEqual(result, { manager: "pnpm", scripts: ["test", "lint"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not execute project scripts without explicit user approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "echo quality-ok" } }));
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
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "echo quality-ok" } }));
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


test("aborts a running project script when the task is cancelled", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-abort-"));
  const controller = new AbortController();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: { test: 'node -e "setTimeout(() => {}, 30000)"' }
    }));
    const running = runProjectQualityChecks(root, async () => true, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 100));
    controller.abort();
    const results = await running;
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, false);
    assert.match(results[0].output ?? "", /Cancelled by the user/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("discovers Go, Rust, Python and .NET project verification commands", async () => {
  const goRoot = await mkdtemp(join(tmpdir(), "bb-quality-go-"));
  const rustRoot = await mkdtemp(join(tmpdir(), "bb-quality-rust-"));
  const pythonRoot = await mkdtemp(join(tmpdir(), "bb-quality-python-"));
  const dotnetRoot = await mkdtemp(join(tmpdir(), "bb-quality-dotnet-"));
  try {
    await writeFile(join(goRoot, "go.mod"), "module example.com/project\n");
    await writeFile(join(rustRoot, "Cargo.toml"), "[package]\nname='example'\nversion='0.1.0'\n");
    await writeFile(join(pythonRoot, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n[build-system]\nrequires=[]\nbuild-backend='setuptools.build_meta'\n");
    await mkdir(join(pythonRoot, "tests"));
    await writeFile(join(dotnetRoot, "App.csproj"), "<Project />");

    assert.deepEqual(await discoverQualityScripts(goRoot), { manager: "go", scripts: ["test", "lint", "build"] });
    assert.deepEqual(await discoverQualityScripts(rustRoot), { manager: "cargo", scripts: ["test", "lint", "typecheck", "build"] });
    assert.deepEqual(await discoverQualityScripts(pythonRoot), { manager: "python", scripts: ["test", "lint", "typecheck", "build"] });
    assert.deepEqual(await discoverQualityScripts(dotnetRoot), { manager: "dotnet", scripts: ["test", "lint", "build"] });
  } finally {
    await Promise.all([goRoot, rustRoot, pythonRoot, dotnetRoot].map(path => rm(path, { recursive: true, force: true })));
  }
});

test("maps non-Node project checks to explicit toolchain commands", () => {
  assert.equal(qualityCommand("go", "test").display, "go test ./...");
  assert.equal(qualityCommand("cargo", "lint").display, "cargo clippy --all-targets --all-features -- -D warnings");
  assert.equal(qualityCommand("python", "test").display, "python3 -m pytest -q");
  assert.equal(qualityCommand("dotnet", "build").display, "dotnet build");
});

test("fails closed when no project quality manifest or supported scripts exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-quality-unsupported-"));
  try {
    let approvalRequested = false;
    const results = await runProjectQualityChecks(root, async () => { approvalRequested = true; return true; });
    assert.equal(approvalRequested, false);
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, false);
    assert.match(results[0].output ?? "", /no supported root project manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
