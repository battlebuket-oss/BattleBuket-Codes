import type { AgentAdapter, AgentEvent, AgentResult, AgentTask, DirectorDecision, VerificationResult } from "@battlebuket/agent-contracts";

export type DirectorState =
  | { status: "idle" }
  | { status: "planning"; task: AgentTask }
  | { status: "running"; task: AgentTask; provider: string }
  | { status: "reviewing"; task: AgentTask; result: AgentResult }
  | { status: "completed"; task: AgentTask; result: AgentResult }
  | { status: "failed"; task: AgentTask; reason: string }
  | { status: "cancelled"; task: AgentTask };

export interface DirectorHooks {
  decide(task: AgentTask): Promise<DirectorDecision>;
  verify(task: AgentTask, result: AgentResult): Promise<VerificationResult[]>;
  emit(event: AgentEvent): void;
  approve?(task: AgentTask, decision: DirectorDecision): Promise<boolean>;
}

export class EngineeringDirector {
  private current: DirectorState = { status: "idle" };
  private activeAdapter?: AgentAdapter;
  private activeTaskId?: string;
  constructor(private readonly adapters: AgentAdapter[], private readonly hooks: DirectorHooks) {}
  get state(): DirectorState { return this.current; }
  async execute(task: AgentTask): Promise<AgentResult> {
    if (["planning", "running", "reviewing"].includes(this.current.status)) throw new Error("Director is already handling a task");
    this.current = { status: "planning", task };
    try {
      const decision = await this.hooks.decide(task);
      if (decision.requiresHumanApproval) {
        const approved = await this.hooks.approve?.(task, decision);
        if (!approved) { this.current = { status: "cancelled", task }; throw new Error("Task requires human approval"); }
      }
      const adapter = this.adapters.find(item => item.provider === decision.primary);
      if (!adapter || !(await adapter.isAvailable())) throw new Error("Selected agent provider is unavailable");
      this.activeAdapter = adapter;
      this.activeTaskId = task.id;
      this.current = { status: "running", task, provider: adapter.provider };
      const result = await adapter.run({ task, provider: adapter.provider, workingDirectory: task.workspacePath, approvalMode: task.risk === "medium" ? "workspace-write" : "read-only" }, event => this.hooks.emit(event));
      if (result.status !== "succeeded") {
        if (result.status === "cancelled") this.current = { status: "cancelled", task };
        else this.current = { status: "failed", task, reason: result.summary };
        return result;
      }
      this.current = { status: "reviewing", task, result };
      const checks = await this.hooks.verify(task, result);
      const reviewed = { ...result, verification: [...result.verification, ...checks] };
      if (checks.some(check => !check.passed)) {
        this.current = { status: "failed", task, reason: "One or more verification checks failed" };
        return { ...reviewed, status: "failed", summary: "Agent changes require fixes: verification failed" };
      }
      this.current = { status: "completed", task, result: reviewed };
      return reviewed;
    } catch (error) {
      if (this.current.status !== "cancelled") this.current = { status: "failed", task, reason: error instanceof Error ? error.message : "Unknown Director error" };
      throw error;
    } finally { this.activeAdapter = undefined; this.activeTaskId = undefined; }
  }
  async cancel(): Promise<void> {
    if (!this.activeAdapter || !this.activeTaskId) return;
    await this.activeAdapter.cancel(this.activeTaskId);
    if (this.current.status !== "idle") this.current = { status: "cancelled", task: this.current.task };
  }
}