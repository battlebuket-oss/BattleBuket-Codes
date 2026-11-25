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
  verify(task: AgentTask, result: AgentResult, signal?: AbortSignal): Promise<VerificationResult[]>;
  review?(task: AgentTask, result: AgentResult, decision: DirectorDecision, signal?: AbortSignal): Promise<VerificationResult>;
  emit(event: AgentEvent): void;
  approve?(task: AgentTask, decision: DirectorDecision): Promise<boolean>;
}

export class EngineeringDirector {
  private current: DirectorState = { status: "idle" };
  private activeAdapter?: AgentAdapter;
  private activeTaskId?: string;
  private cancellation?: AbortController;
  constructor(private readonly adapters: AgentAdapter[], private readonly hooks: DirectorHooks) {}
  get state(): DirectorState { return this.current; }
  async execute(task: AgentTask): Promise<AgentResult> {
    if (["planning", "running", "reviewing"].includes(this.current.status)) throw new Error("Director is already handling a task");
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    this.current = { status: "planning", task };
    const cancelledResult = (): AgentResult => ({ taskId: task.id, status: "cancelled", summary: "Task was cancelled.", changedFiles: [], verification: [] });
    try {
      const decision = await this.hooks.decide(task);
      if (cancellation.signal.aborted) { this.current = { status: "cancelled", task }; return cancelledResult(); }

      // Medium-risk tasks are the only write-capable mode. They must have a
      // genuinely separate, available reviewer before the implementation
      // provider is allowed to make any workspace changes.
      if (task.risk === "medium") {
        let reviewBlocker: string | undefined;
        if (!decision.reviewer) {
          reviewBlocker = "No alternate provider is available for the required independent read-only review. The write-capable task was not started.";
        } else if (decision.reviewer === decision.primary) {
          reviewBlocker = "The reviewer must be a different provider from the implementation provider. The write-capable task was not started.";
        } else if (!this.hooks.review) {
          reviewBlocker = "The independent read-only review hook is not configured. The write-capable task was not started.";
        } else {
          const reviewerAdapter = this.adapters.find(item => item.provider === decision.reviewer);
          if (!reviewerAdapter) {
            reviewBlocker = "The selected independent review provider is not configured. The write-capable task was not started.";
          } else {
            let reviewerAvailable = false;
            try { reviewerAvailable = await reviewerAdapter.isAvailable(); }
            catch { reviewerAvailable = false; }
            if (!reviewerAvailable) {
              reviewBlocker = "The selected independent review provider is unavailable. The write-capable task was not started.";
            }
          }
        }
        if (reviewBlocker) {
          const failedReview: VerificationResult = {
            name: "Independent read-only provider review",
            passed: false,
            output: reviewBlocker
          };
          this.current = { status: "failed", task, reason: reviewBlocker };
          return {
            taskId: task.id,
            status: "failed",
            summary: "Task blocked before implementation because independent review is unavailable.",
            changedFiles: [],
            verification: [failedReview]
          };
        }
        if (cancellation.signal.aborted) { this.current = { status: "cancelled", task }; return cancelledResult(); }
      }

      if (decision.requiresHumanApproval) {
        const approved = await this.hooks.approve?.(task, decision);
        if (cancellation.signal.aborted || !approved) { this.current = { status: "cancelled", task }; return cancelledResult(); }
      }
      const adapter = this.adapters.find(item => item.provider === decision.primary);
      if (!adapter || !(await adapter.isAvailable())) throw new Error("Selected agent provider is unavailable");
      if (cancellation.signal.aborted) { this.current = { status: "cancelled", task }; return cancelledResult(); }
      this.activeAdapter = adapter;
      this.activeTaskId = task.id;
      this.current = { status: "running", task, provider: adapter.provider };
      const result = await adapter.run({ task, provider: adapter.provider, workingDirectory: task.workspacePath, approvalMode: task.risk === "medium" ? "workspace-write" : "read-only", abortSignal: cancellation.signal }, event => this.hooks.emit(event));
      if (cancellation.signal.aborted || result.status === "cancelled") {
        this.current = { status: "cancelled", task };
        return { ...result, status: "cancelled", summary: result.summary || "Task was cancelled." };
      }
      if (result.status !== "succeeded") {
        this.current = { status: "failed", task, reason: result.summary };
        return result;
      }
      this.current = { status: "reviewing", task, result };
      const reviewChecks: VerificationResult[] = [];
      if (decision.reviewer) {
        if (!this.hooks.review) {
          reviewChecks.push({
            name: "Read-only provider review",
            passed: false,
            output: "A reviewer provider was selected but no review hook is configured."
          });
        } else if (cancellation.signal.aborted) {
          this.current = { status: "cancelled", task };
          return cancelledResult();
        } else {
          this.activeAdapter = this.adapters.find(item => item.provider === decision.reviewer);
          this.activeTaskId = task.id;
          reviewChecks.push(await this.hooks.review(task, result, decision, cancellation.signal));
          this.activeAdapter = adapter;
        }
      }
      const checks = await this.hooks.verify(task, result, cancellation.signal);
      const allChecks = [...reviewChecks, ...checks];
      const reviewed = { ...result, verification: [...result.verification, ...allChecks] };
      if (cancellation.signal.aborted) {
        this.current = { status: "cancelled", task };
        return { ...reviewed, status: "cancelled", summary: "Task was cancelled during review or verification." };
      }
      if (allChecks.some(check => !check.passed)) {
        this.current = { status: "failed", task, reason: "One or more verification checks failed" };
        return { ...reviewed, status: "failed", summary: "Agent changes require fixes: verification failed" };
      }
      this.current = { status: "completed", task, result: reviewed };
      return reviewed;
    } catch (error) {
      if (cancellation.signal.aborted) {
        this.current = { status: "cancelled", task };
        return cancelledResult();
      }
      this.current = { status: "failed", task, reason: error instanceof Error ? error.message : "Unknown Director error" };
      throw error;
    } finally { this.activeAdapter = undefined; this.activeTaskId = undefined; this.cancellation = undefined; }
  }
  async cancel(): Promise<void> {
    const current = this.current;
    if (current.status !== "planning" && current.status !== "running" && current.status !== "reviewing") return;
    this.cancellation?.abort();
    this.current = { status: "cancelled", task: current.task };
    if (this.activeAdapter && this.activeTaskId) await this.activeAdapter.cancel(this.activeTaskId);
  }
}