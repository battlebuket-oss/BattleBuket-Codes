import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EngineeringDirector } from "../src/index.js";
import type { AgentAdapter, AgentResult, AgentTask } from "@battlebuket/agent-contracts";

const task: AgentTask = { id: "task-1", title: "Add a test", prompt: "Add a test", workspacePath: "/workspace", acceptanceCriteria: [], risk: "low", createdAt: new Date(0).toISOString() };

function adapter(result: AgentResult): AgentAdapter {
  return { provider: "codex", isAvailable: async () => true, run: async () => result, cancel: async () => {} };
}

describe("EngineeringDirector", () => {
  it("marks a task complete only after all verification passes", async () => {
    const director = new EngineeringDirector([adapter({ taskId: task.id, status: "succeeded", summary: "Done", changedFiles: [], verification: [] })], {
      decide: async () => ({ primary: "codex", rationale: "Test adapter", requiresHumanApproval: false }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(result.status, "succeeded");
    assert.equal(director.state.status, "completed");
  });
  it("uses read-only mode for low and high risk tasks and workspace writes only for medium risk", async () => {
    const modes: string[] = [];
    const captureAdapter: AgentAdapter = {
      provider: "codex",
      isAvailable: async () => true,
      run: async request => {
        modes.push(request.approvalMode);
        return { taskId: request.task.id, status: "succeeded", summary: "Done", changedFiles: [], verification: [] };
      },
      cancel: async () => {}
    };
    for (const risk of ["low", "medium", "high"] as const) {
      const director = new EngineeringDirector([captureAdapter], {
        decide: async () => ({ primary: "codex", rationale: "Permission mapping test", requiresHumanApproval: false }),
        verify: async () => [{ name: "permission test", passed: true }],
        emit: () => {}
      });
      await director.execute({ ...task, id: "risk-" + risk, risk });
    }
    assert.deepEqual(modes, ["read-only", "workspace-write", "read-only"]);
  });
  it("fails the task when verification fails", async () => {
    const director = new EngineeringDirector([adapter({ taskId: task.id, status: "succeeded", summary: "Done", changedFiles: [], verification: [] })], {
      decide: async () => ({ primary: "codex", rationale: "Test adapter", requiresHumanApproval: false }),
      verify: async () => [{ name: "tests", passed: false }],
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(result.status, "failed");
    assert.equal(director.state.status, "failed");
  });
});