import test from "node:test";
import assert from "node:assert/strict";
import { codexArguments } from "../src/index";

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

test("Codex workspace-write mode uses the CLI's approval review and never full access", () => {
  const args = codexArguments(request("workspace-write"));
  assert.ok(args.includes("--approve-for-me"));
  assert.ok(!args.includes("--yolo"));
  assert.ok(!args.includes("danger-full-access"));
});

test("Codex adapter rejects full-access execution", () => {
  assert.throws(() => codexArguments(request("full-access")), /Full-access/);
});
