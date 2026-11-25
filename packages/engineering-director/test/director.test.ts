import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EngineeringDirector } from "../src/index.js";
import type { AgentAdapter, AgentProvider, AgentResult, AgentTask } from "@battlebuket/agent-contracts";

const task: AgentTask = { id: "task-1", title: "Add a test", prompt: "Add a test", workspacePath: "/workspace", acceptanceCriteria: [], risk: "low", createdAt: new Date(0).toISOString() };

function adapter(result: AgentResult, provider: AgentProvider = "codex"): AgentAdapter {
  return { provider, isAvailable: async () => true, run: async () => result, cancel: async () => {} };
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

  it("uses read-only mode for low and high risk tasks and workspace writes only for reviewed medium risk", async () => {
    const modes: string[] = [];
    const implementation = adapter({
      taskId: task.id, status: "succeeded", summary: "Done", changedFiles: [], verification: []
    });
    const captureAdapter: AgentAdapter = {
      ...implementation,
      run: async request => {
        modes.push(request.approvalMode);
        return { taskId: request.task.id, status: "succeeded", summary: "Done", changedFiles: [], verification: [] };
      }
    };
    const reviewer = adapter({
      taskId: task.id, status: "succeeded", summary: "Reviewed", changedFiles: [], verification: []
    }, "claude");
    for (const risk of ["low", "medium", "high"] as const) {
      const director = new EngineeringDirector([captureAdapter, reviewer], {
        decide: async () => ({
          primary: "codex",
          ...(risk === "medium" ? { reviewer: "claude" as const } : {}),
          rationale: "Permission mapping test",
          requiresHumanApproval: false
        }),
        review: async () => ({ name: "Read-only provider review", passed: true }),
        verify: async () => [{ name: "permission test", passed: true }],
        emit: () => {}
      });
      const result = await director.execute({ ...task, id: "risk-" + risk, risk });
      assert.equal(result.status, "succeeded");
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

  it("requires a different available provider's read-only review before a write-capable task completes", async () => {
    let reviewed = false;
    const implementation = adapter({
      taskId: task.id, status: "succeeded", summary: "Implemented", changedFiles: ["src/app.ts"], verification: []
    });
    const reviewer = adapter({
      taskId: task.id, status: "succeeded", summary: "Review", changedFiles: [], verification: []
    }, "claude");
    const director = new EngineeringDirector([implementation, reviewer], {
      decide: async () => ({ primary: "codex", reviewer: "claude", rationale: "Independent review", requiresHumanApproval: false }),
      review: async () => {
        reviewed = true;
        return { name: "Read-only provider review", passed: true, output: "BATTLEBUKET_REVIEW: APPROVE" };
      },
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute({ ...task, risk: "medium" });
    assert.equal(reviewed, true);
    assert.equal(result.status, "succeeded");
    assert.equal(result.verification.some(check => check.name === "Read-only provider review" && check.passed), true);
  });

  it("fails closed when no independent reviewer is selected, before the write-capable provider runs", async () => {
    let implementationStarted = false;
    const implementation: AgentAdapter = {
      provider: "codex",
      isAvailable: async () => true,
      run: async request => {
        implementationStarted = true;
        return { taskId: request.task.id, status: "succeeded", summary: "Should not run", changedFiles: [], verification: [] };
      },
      cancel: async () => {}
    };
    const director = new EngineeringDirector([implementation], {
      decide: async () => ({ primary: "codex", rationale: "Alternate provider unavailable", requiresHumanApproval: false }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute({ ...task, risk: "medium" });
    assert.equal(implementationStarted, false);
    assert.equal(result.status, "failed");
    assert.equal(result.changedFiles.length, 0);
    assert.equal(result.verification.some(check =>
      check.name === "Independent read-only provider review" && !check.passed
    ), true);
    assert.equal(director.state.status, "failed");
  });

  it("fails closed when the reviewer is the same provider as the implementation provider", async () => {
    let implementationStarted = false;
    const implementation: AgentAdapter = {
      provider: "codex",
      isAvailable: async () => true,
      run: async request => {
        implementationStarted = true;
        return { taskId: request.task.id, status: "succeeded", summary: "Should not run", changedFiles: [], verification: [] };
      },
      cancel: async () => {}
    };
    const director = new EngineeringDirector([implementation], {
      decide: async () => ({ primary: "codex", reviewer: "codex", rationale: "Not independent", requiresHumanApproval: false }),
      review: async () => ({ name: "Read-only provider review", passed: true }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute({ ...task, risk: "medium" });
    assert.equal(implementationStarted, false);
    assert.equal(result.status, "failed");
    assert.match(result.verification[0]?.output ?? "", /different provider/);
  });

  it("fails closed when the configured reviewer adapter is not available", async () => {
    let implementationStarted = false;
    const implementation: AgentAdapter = {
      provider: "codex",
      isAvailable: async () => true,
      run: async request => {
        implementationStarted = true;
        return { taskId: request.task.id, status: "succeeded", summary: "Should not run", changedFiles: [], verification: [] };
      },
      cancel: async () => {}
    };
    const director = new EngineeringDirector([implementation], {
      decide: async () => ({ primary: "codex", reviewer: "claude", rationale: "Reviewer not configured", requiresHumanApproval: false }),
      review: async () => ({ name: "Read-only provider review", passed: true }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute({ ...task, risk: "medium" });
    assert.equal(implementationStarted, false);
    assert.equal(result.status, "failed");
    assert.match(result.verification[0]?.output ?? "", /not configured/);
  });

  it("fails closed when a configured reviewer rejects the implementation", async () => {
    const implementation = adapter({
      taskId: task.id, status: "succeeded", summary: "Implemented", changedFiles: [], verification: []
    });
    const reviewer = adapter({
      taskId: task.id, status: "succeeded", summary: "Review", changedFiles: [], verification: []
    }, "claude");
    const director = new EngineeringDirector([implementation, reviewer], {
      decide: async () => ({ primary: "codex", reviewer: "claude", rationale: "Independent review", requiresHumanApproval: false }),
      review: async () => ({ name: "Read-only provider review", passed: false, output: "BATTLEBUKET_REVIEW: REJECT\nA blocker was found." }),
      verify: async () => [{ name: "typecheck", passed: true }],
      emit: () => {}
    });
    const result = await director.execute({ ...task, risk: "medium" });
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
