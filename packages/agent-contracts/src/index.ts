export type AgentProvider = "codex" | "claude";
export type TaskStatus = "queued" | "planning" | "running" | "reviewing" | "completed" | "failed" | "cancelled";
export type RiskLevel = "low" | "medium" | "high";

export interface AcceptanceCriterion { id: string; description: string; required: boolean; }
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  workspacePath: string;
  acceptanceCriteria: AcceptanceCriterion[];
  risk: RiskLevel;
  createdAt: string;
}
export interface AgentRunRequest {
  task: AgentTask;
  provider: AgentProvider;
  workingDirectory: string;
  approvalMode: "read-only" | "workspace-write" | "full-access";
  abortSignal?: AbortSignal;
}
export interface AgentEvent {
  type: "message" | "progress" | "file-change" | "command" | "warning" | "error" | "completed";
  taskId: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}
export interface AgentResult {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  changedFiles: string[];
  verification: VerificationResult[];
}
export interface VerificationResult {
  name: string;
  passed: boolean;
  output?: string;
}
export interface AgentAdapter {
  readonly provider: AgentProvider;
  isAvailable(): Promise<boolean>;
  run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentResult>;
  cancel(taskId: string): Promise<void>;
}
export interface DirectorDecision {
  primary: AgentProvider;
  reviewer?: AgentProvider;
  rationale: string;
  requiresHumanApproval: boolean;
}
