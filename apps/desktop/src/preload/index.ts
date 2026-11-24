import { contextBridge, ipcRenderer } from "electron";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
type AgentProvider = "codex" | "claude";
type TaskRisk = "low" | "medium" | "high";
type AgentEvent = {
  type: "message" | "progress" | "file-change" | "command" | "warning" | "error" | "completed";
  taskId: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
};
type TerminalSessionEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  stream?: "stdout" | "stderr";
  text?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

type TaskHistoryItem = {
  taskId: string;
  provider: AgentProvider;
  risk: TaskRisk;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  changedFileCount?: number;
  verificationPassed?: boolean;
};
type AgentResult = {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  changedFiles: string[];
  verification: { name: string; passed: boolean; output?: string }[];
};

contextBridge.exposeInMainWorld("battleBuket", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("platform:version"),
  selectWorkspace: (): Promise<string | null> => ipcRenderer.invoke("workspace:select"),
  listWorkspace: (path = ""): Promise<WorkspaceEntry[]> => ipcRenderer.invoke("workspace:list", path),
  readWorkspaceFile: (path: string): Promise<{ path: string; content: string; mtimeMs: number }> => ipcRenderer.invoke("workspace:read", path),
  saveWorkspaceFile: (payload: { path: string; content: string; expectedMtimeMs: number }): Promise<{ path: string; mtimeMs: number }> => ipcRenderer.invoke("workspace:write", payload),
  getAgentAvailability: (): Promise<Record<AgentProvider, boolean>> => ipcRenderer.invoke("agents:availability"),
  getTaskHistory: (): Promise<TaskHistoryItem[]> => ipcRenderer.invoke("tasks:history"),
  startTerminal: (): Promise<string> => ipcRenderer.invoke("terminal:start"),
  writeTerminal: (sessionId: string, input: string): Promise<boolean> => ipcRenderer.invoke("terminal:write", { sessionId, input }),
  closeTerminal: (sessionId: string): Promise<boolean> => ipcRenderer.invoke("terminal:close", { sessionId }),
  onTerminalEvent: (listener: (event: TerminalSessionEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TerminalSessionEvent) => listener(payload);
    ipcRenderer.on("terminal:event", handler);
    return () => ipcRenderer.removeListener("terminal:event", handler);
  },
  runAgent: (payload: { prompt: string; provider: AgentProvider; risk: TaskRisk }): Promise<AgentResult> => ipcRenderer.invoke("agents:run", payload),
  cancelAgent: (): Promise<boolean> => ipcRenderer.invoke("agents:cancel"),
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  }
});
