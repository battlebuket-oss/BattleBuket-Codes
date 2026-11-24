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

  it("requires the configured read-only reviewer pass before task completion", async () => {
    let reviewed = false;
    const director = new EngineeringDirector([adapter({ taskId: task.id, status: "succeeded", summary: "Implemented", changedFiles: ["src/app.ts"], verification: [] })], {
      decide: async () => ({ primary: "codex", reviewer: "codex", rationale: "Same-provider review", requiresHumanApproval: false }),
      review: async () => {
        reviewed = true;
        return { name: "Read-only provider review", passed: true, output: "BATTLEBUKET_REVIEW: APPROVE" };
      },
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(reviewed, true);
    assert.equal(result.status, "succeeded");
    assert.equal(result.verification.some(check => check.name === "Read-only provider review" && check.passed), true);
  });

  it("fails closed when a configured reviewer rejects the implementation", async () => {
    const director = new EngineeringDirector([adapter({ taskId: task.id, status: "succeeded", summary: "Implemented", changedFiles: [], verification: [] })], {
      decide: async () => ({ primary: "codex", reviewer: "codex", rationale: "Same-provider review", requiresHumanApproval: false }),
      review: async () => ({ name: "Read-only provider review", passed: false, output: "BATTLEBUKET_REVIEW: REJECT\\nA blocker was found." }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(result.status, "failed");
    assert.equal(result.verification.some(check => check.name === "Read-only provider review" && !check.passed), true);
  });
  it("fails closed when a selected reviewer is unavailable or not configured", async () => {
    const director = new EngineeringDirector([adapter({ taskId: task.id, status: "succeeded", summary: "Implemented", changedFiles: [], verification: [] })], {
      decide: async () => ({ primary: "codex", reviewer: "claude", rationale: "Unavailable reviewer", requiresHumanApproval: false }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(result.status, "failed");
    assert.equal(result.verification.some(check => check.name === "Read-only provider review" && !check.passed), true);
  });

  it("preserves cancellation requested during the reviewer pass", async () => {
    let cancelCalled = false;
    const cancellable: AgentAdapter = {
      provider: "codex",
      isAvailable: async () => true,
      run: async request => ({ taskId: request.task.id, status: "succeeded", summary: "Implemented", changedFiles: [], verification: [] }),
      cancel: async taskId => { assert.equal(taskId, task.id); cancelCalled = true; }
    };
    let director!: EngineeringDirector;
    director = new EngineeringDirector([cancellable], {
      decide: async () => ({ primary: "codex", reviewer: "codex", rationale: "Cancellation test", requiresHumanApproval: false }),
      review: async (_task, _result, _decision, signal) => {
        assert.equal(signal?.aborted, false);
        await director.cancel();
        assert.equal(signal?.aborted, true);
        return { name: "Read-only provider review", passed: false, output: "Cancelled" };
      },
      verify: async (_task, _result, signal) => {
        assert.equal(signal?.aborted, true);
        return [{ name: "typecheck", passed: false, output: "Cancelled" }];
      },
      emit: () => {}
    });
    const result = await director.execute(task);
    assert.equal(cancelCalled, true);
    assert.equal(result.status, "cancelled");
    assert.equal(director.state.status, "cancelled");
  });

});