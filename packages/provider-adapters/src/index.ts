import { execa, type ResultPromise } from "execa";
import { query, startup } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAdapter, AgentEvent, AgentResult, AgentRunRequest } from "@battlebuket/agent-contracts";

type ActiveRun = { abort: AbortController; process?: ResultPromise };
const active = new Map<string, ActiveRun>();
const now = () => new Date().toISOString();

function emit(request: AgentRunRequest, send: (event: AgentEvent) => void, type: AgentEvent["type"], message: string, data?: Record<string, unknown>) {
  send({ taskId: request.task.id, timestamp: now(), type, message, ...(data ? { data } : {}) });
}

async function changedFiles(cwd: string): Promise<string[]> {
  const result = await execa("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, reject: false });
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean);
}

export function codexArguments(request: AgentRunRequest): string[] {
  if (request.approvalMode === "full-access") throw new Error("Full-access agent execution is disabled");
  const base = ["exec", "--json", "--cd", request.workingDirectory];
  if (request.approvalMode === "read-only") return [...base, "--sandbox", "read-only", "--ask-for-approval", "never", request.task.prompt];
  return [...base, "--approve-for-me", request.task.prompt];
}

export class CodexCliAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  async isAvailable(): Promise<boolean> {
    const result = await execa("codex", ["login", "status"], { reject: false });
    return result.exitCode === 0;
  }
  async run(request: AgentRunRequest, send: (event: AgentEvent) => void): Promise<AgentResult> {
    if (active.has(request.task.id)) throw new Error("Task is already running");
    const controller = new AbortController();
    const run: ActiveRun = { abort: controller };
    active.set(request.task.id, run);
    emit(request, send, "progress", "Starting Codex CLI in the selected workspace");
    let output = "";
    try {
      const child = execa("codex", codexArguments(request), { cwd: request.workingDirectory, cancelSignal: controller.signal, reject: false });
      run.process = child;
      child.stdout?.on("data", chunk => {
        output += String(chunk);
        const lines = output.split(/\r?\n/);
        output = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const message = typeof event.msg === "string" ? event.msg : typeof event.type === "string" ? event.type : "Codex event";
            emit(request, send, "progress", message, { providerEvent: event });
          } catch { emit(request, send, "message", line); }
        }
      });
      const result = await child;
      if (output.trim()) {
        try { emit(request, send, "message", output.trim(), { provider: "codex" }); }
        catch { /* stdout tail is informational */ }
      }
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Codex run cancelled", changedFiles: [], verification: [] };
      if (result.exitCode !== 0) return { taskId: request.task.id, status: "failed", summary: (result.stderr || result.stdout || "Codex exited with code " + result.exitCode).slice(-4000), changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      const files = await changedFiles(request.workingDirectory);
      emit(request, send, "completed", "Codex finished; review the resulting workspace diff");
      return { taskId: request.task.id, status: "succeeded", summary: (result.stdout || "Codex completed successfully").slice(-4000), changedFiles: files, verification: [] };
    } catch (error) {
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Codex run cancelled", changedFiles: [], verification: [] };
      throw error;
    } finally { active.delete(request.task.id); }
  }
  async cancel(taskId: string): Promise<void> { active.get(taskId)?.abort.abort(); }
}

export class ClaudeAgentSdkAdapter implements AgentAdapter {
  readonly provider = "claude" as const;
  async isAvailable(): Promise<boolean> {
    let warm: Awaited<ReturnType<typeof startup>> | undefined;
    try {
      warm = await startup({
        options: { cwd: process.cwd(), settingSources: [], permissionMode: "plan", maxTurns: 1 },
        initializeTimeoutMs: 8000
      });
      return true;
    } catch {
      return false;
    } finally {
      warm?.close();
    }
  }
  async run(request: AgentRunRequest, send: (event: AgentEvent) => void): Promise<AgentResult> {
    if (active.has(request.task.id)) throw new Error("Task is already running");
    if (request.approvalMode === "full-access") throw new Error("Full-access agent execution is disabled");
    const controller = new AbortController();
    active.set(request.task.id, { abort: controller });
    emit(request, send, "progress", "Starting Claude Agent SDK in the selected workspace");
    let summary = "";
    try {
      const stream = query({
        prompt: request.task.prompt,
        options: {
          cwd: request.workingDirectory,
          abortController: controller,
          permissionMode: request.approvalMode === "read-only" ? "plan" : "acceptEdits",
          disallowedTools: ["Bash"],
          persistSession: false
        }
      });
      for await (const message of stream) {
        if (message.type === "result") {
          const resultMessage = message as typeof message & { result?: string; subtype?: string };
          summary = resultMessage.result ?? summary;
          if (resultMessage.subtype && resultMessage.subtype !== "success") {
            return { taskId: request.task.id, status: "failed", summary: summary || "Claude returned " + resultMessage.subtype, changedFiles: await changedFiles(request.workingDirectory), verification: [] };
          }
        } else {
          emit(request, send, "progress", "Claude SDK event: " + message.type, { providerEvent: message });
        }
      }
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Claude run cancelled", changedFiles: [], verification: [] };
      const files = await changedFiles(request.workingDirectory);
      emit(request, send, "completed", "Claude finished; review the resulting workspace diff");
      return { taskId: request.task.id, status: "succeeded", summary: summary || "Claude completed successfully", changedFiles: files, verification: [] };
    } catch (error) {
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Claude run cancelled", changedFiles: [], verification: [] };
      throw error;
    } finally { active.delete(request.task.id); }
  }
  async cancel(taskId: string): Promise<void> { active.get(taskId)?.abort.abort(); }
}
