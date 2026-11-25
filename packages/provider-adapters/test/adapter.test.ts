import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, claudeAllowedTools, codexArguments, linkAbortSignal, supportsCodexCli } from "../src/index";

const request = (approvalMode: "read-only" | "workspace-write" | "full-access") => ({
  provider: "codex" as const,
  workingDirectory: "/tmp/project",
  approvalMode,
  task: { id: "task-1", title: "Inspect", prompt: "Review source", workspacePath: "/tmp/project", acceptanceCriteria: [], risk: "low" as const, createdAt: new Date(0).toISOString() }
});

test("Codex read-only mode explicitly disables command approvals and writes", () => {
  const args = codexArguments(request("read-only"));
  assert.deepEqual(args.slice(0, 8), ["exec", "--json", "--cd", "/tmp/project", "--sandbox", "read-only", "--ask-for-approval", "never"]);
  assert.equal(args.at(-1), "Review source");
});

test("Codex workspace-write mode is sandboxed and routes permission escalations to automatic review", () => {
  const args = codexArguments(request("workspace-write"));
  assert.deepEqual(args.slice(4, 12), ["--sandbox", "workspace-write", "--ask-for-approval", "on-request", "--config", "approvals_reviewer=auto_review", "--config", "sandbox_workspace_write.network_access=false"]);
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!args.includes("--full-auto"));
  assert.ok(!args.includes("--yolo"));
});

test("Codex adapter rejects full-access execution", () => {
  assert.throws(() => codexArguments(request("full-access")), /Full-access/);
});

test("Claude read-only and edit modes expose only their approved workspace tools", () => {
  assert.deepEqual(claudeAllowedTools("read-only"), ["Read", "Glob", "Grep"]);
  assert.deepEqual(claudeAllowedTools("workspace-write"), ["Read", "Edit", "Write", "Glob", "Grep"]);
  assert.throws(() => claudeAllowedTools("full-access"), /Full-access/);
});

test("Codex preflight rejects versions that predate the supported permission flags", () => {
  assert.equal(supportsCodexCli("codex-cli 0.171.0"), true);
  assert.equal(supportsCodexCli("codex-cli 0.172.0"), true);
  assert.equal(supportsCodexCli("codex-cli 0.170.9"), false);
  assert.equal(supportsCodexCli("codex-cli unknown"), false);
});

test("provider adapters inherit caller abort signals and detach listeners", () => {
  const parent = new AbortController();
  const child = new AbortController();
  const unlink = linkAbortSignal(parent.signal, child);
  assert.equal(child.signal.aborted, false);
  parent.abort(new Error("cancelled"));
  assert.equal(child.signal.aborted, true);
  unlink();

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const nextChild = new AbortController();
  linkAbortSignal(alreadyAborted.signal, nextChild);
  assert.equal(nextChild.signal.aborted, true);
});

test("changed-file collection includes modified tracked files and untracked nested files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "bb-provider-changed-files-"));
  try {
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "BattleBuket Test"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: workspace, stdio: "ignore" });
    await writeFile(join(workspace, "tracked.txt"), "baseline\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: workspace, stdio: "ignore" });

    await writeFile(join(workspace, "tracked.txt"), "modified\n", "utf8");
    await mkdir(join(workspace, "nested"));
    await writeFile(join(workspace, "nested", "new.ts"), "export {};\n", "utf8");

    const files = await changedFiles(workspace);
    assert.deepEqual(files.sort(), ["nested/new.ts", "tracked.txt"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
