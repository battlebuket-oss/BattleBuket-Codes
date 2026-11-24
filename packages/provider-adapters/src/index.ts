import { execa, type ResultPromise } from "execa";
import { query, startup } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAdapter, AgentEvent, AgentResult, AgentRunRequest } from "@battlebuket/agent-contracts";

type ActiveRun = { abort: AbortController; process?: ResultPromise };
const active = new Map<string, ActiveRun>();
const now = () => new Date().toISOString();
const MAX_AGENT_RUNTIME_MS = 45 * 60 * 1000;

function emit(request: AgentRunRequest, send: (event: AgentEvent) => void, type: AgentEvent["type"], message: string, data?: Record<string, unknown>) {
  send({ taskId: request.task.id, timestamp: now(), type, message, ...(data ? { data } : {}) });
}

export function claudeAllowedTools(mode: AgentRunRequest["approvalMode"]): string[] {
  if (mode === "full-access") throw new Error("Full-access agent execution is disabled");
  return mode === "read-only"
    ? ["Read", "Glob", "Grep"]
    : ["Read", "Edit", "Write", "Glob", "Grep"];
}

async function changedFiles(cwd: string): Promise<string[]> {
  const result = await execa("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd, reject: false, maxBuffer: 2 * 1024 * 1024, timeout: 15_000
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean);
}

export function codexArguments(request: AgentRunRequest): string[] {
  if (request.approvalMode === "full-access") throw new Error("Full-access agent execution is disabled");
  const base = ["exec", "--json", "--cd", request.workingDirectory];
  if (request.approvalMode === "read-only") return [...base, "--sandbox", "read-only", "--ask-for-approval", "never", request.task.prompt];
  return [
    ...base,
    "--sandbox", "workspace-write",
    "--ask-for-approval", "on-request",
    "--config", "approvals_reviewer=auto_review",
    "--config", "sandbox_workspace_write.network_access=false",
    request.task.prompt
  ];
}

export class CodexCliAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  async isAvailable(): Promise<boolean> {
    const result = await execa("codex", ["login", "status"], { reject: false, timeout: 8000, maxBuffer: 64 * 1024 });
    return result.exitCode === 0;
  }
  async run(request: AgentRunRequest, send: (event: AgentEvent) => void): Promise<AgentResult> {
    if (active.has(request.task.id)) throw new Error("Task is already running");
    const controller = new AbortController();
    const run: ActiveRun = { abort: controller };
    active.set(request.task.id, run);
    emit(request, send, "progress", "Starting Codex CLI in the selected workspace");
    let pendingLine = "";
    let totalOutputBytes = 0;
    let assistantSummary = "";
    let stderrTail = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); }, MAX_AGENT_RUNTIME_MS);
    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          msg?: string;
          item?: { type?: string; text?: string; command?: string };
          error?: { message?: string };
        };
        const item = event.item;
        if (item?.type === "agent_message" && typeof item.text === "string") {
          assistantSummary = item.text;
          emit(request, send, "message", item.text.slice(0, 4000));
        } else if (item?.type === "command_execution" && event.type === "item.started") {
          emit(request, send, "command", "Running a project command inside the selected workspace");
        } else if (event.type === "error") {
          emit(request, send, "error", event.error?.message ?? "Codex reported an execution error");
        } else if (event.type === "turn.started") {
          emit(request, send, "progress", "Codex started the task");
        } else if (event.type === "turn.completed") {
          emit(request, send, "progress", "Codex completed its turn");
        }
      } catch {
        emit(request, send, "warning", "Received an unparseable Codex progress event");
      }
    };
    try {
      const child = execa("codex", codexArguments(request), {
        cwd: request.workingDirectory,
        cancelSignal: controller.signal,
        reject: false,
        buffer: false
      });
      run.process = child;
      child.readable({ from: "stderr", binary: true }).on("data", chunk => {
        stderrTail = (stderrTail + String(chunk)).slice(-4000);
      });
      child.readable({ from: "stdout", binary: true }).on("data", chunk => {
        const text = String(chunk);
        totalOutputBytes += Buffer.byteLength(text, "utf8");
        if (totalOutputBytes > 2 * 1024 * 1024) {
          if (totalOutputBytes - Buffer.byteLength(text, "utf8") <= 2 * 1024 * 1024) {
            emit(request, send, "warning", "Codex progress output exceeded the 2 MB display limit; later events are suppressed");
          }
          return;
        }
        pendingLine += text;
        const lines = pendingLine.split(/\r?\n/);
        pendingLine = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      const result = await child;
      if (pendingLine.trim()) processLine(pendingLine);

      if (timedOut) return { taskId: request.task.id, status: "failed", summary: "Codex task exceeded the 45-minute runtime limit", changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Codex run cancelled", changedFiles: [], verification: [] };
      if (result.exitCode !== 0) return { taskId: request.task.id, status: "failed", summary: (stderrTail || "Codex exited with code " + result.exitCode).slice(-4000), changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      const files = await changedFiles(request.workingDirectory);
      emit(request, send, "completed", "Codex finished; review the resulting workspace diff");
      return { taskId: request.task.id, status: "succeeded", summary: (assistantSummary || "Codex completed successfully").slice(-4000), changedFiles: files, verification: [] };
    } catch (error) {
      if (timedOut) return { taskId: request.task.id, status: "failed", summary: "Codex task exceeded the 45-minute runtime limit", changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Codex run cancelled", changedFiles: [], verification: [] };
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      active.delete(request.task.id);
    }
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
    let timedOut = false;
    const timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); }, MAX_AGENT_RUNTIME_MS);
    try {
      const stream = query({
        prompt: request.task.prompt,
        options: {
          cwd: request.workingDirectory,
          abortController: controller,
          permissionMode: request.approvalMode === "read-only" ? "plan" : "acceptEdits",
          tools: claudeAllowedTools(request.approvalMode),
          settingSources: [],
          strictMcpConfig: true,
          permissionPrompts: "none",
          maxTurns: 40,
          env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "battlebuket-codes" },
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
        } else if (message.type === "assistant") {
          const assistant = message as typeof message & { message?: { content?: Array<{ type?: string; text?: string }> } };
          for (const block of assistant.message?.content ?? []) {
            if (block.type === "text" && typeof block.text === "string") {
              summary = block.text;
              emit(request, send, "message", block.text.slice(0, 4000));
            }
          }
        } else if (message.type === "system") {
          emit(request, send, "progress", "Claude updated the session status");
        } else {
          emit(request, send, "progress", "Claude is processing the task");
        }
      }
      if (timedOut) return { taskId: request.task.id, status: "failed", summary: "Claude task exceeded the 45-minute runtime limit", changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Claude run cancelled", changedFiles: [], verification: [] };
      const files = await changedFiles(request.workingDirectory);
      emit(request, send, "completed", "Claude finished; review the resulting workspace diff");
      return { taskId: request.task.id, status: "succeeded", summary: summary || "Claude completed successfully", changedFiles: files, verification: [] };
    } catch (error) {
      if (timedOut) return { taskId: request.task.id, status: "failed", summary: "Claude task exceeded the 45-minute runtime limit", changedFiles: await changedFiles(request.workingDirectory), verification: [] };
      if (controller.signal.aborted) return { taskId: request.task.id, status: "cancelled", summary: "Claude run cancelled", changedFiles: [], verification: [] };
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      active.delete(request.task.id);
    }
  }
  async cancel(taskId: string): Promise<void> { active.get(taskId)?.abort.abort(); }
}
