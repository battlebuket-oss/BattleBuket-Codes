import test from "node:test";
import assert from "node:assert/strict";
import { claudeAllowedTools, codexArguments } from "../src/index";

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
