type BattleBuketWorkspaceEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number;
  mtimeMs: number;
};
type BattleBuketWorkspaceContentMatch = { path: string; lineNumber: number; preview: string };
type BattleBuketRecentWorkspace = { path: string; lastOpenedAt: string };
type BattleBuketProvider = "codex" | "claude";
type BattleBuketTaskRisk = "low" | "medium" | "high";
type BattleBuketAgentEvent = {
  type: "message" | "progress" | "file-change" | "command" | "warning" | "error" | "completed";
  taskId: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
};
type BattleBuketTerminalEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  text?: string;
  exitCode?: number | null;
  signal?: number;
};
type BattleBuketTaskHistoryItem = {
  taskId: string;
  provider: BattleBuketProvider;
  risk: BattleBuketTaskRisk;
  title?: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  changedFileCount?: number;
  verificationPassed?: boolean;
};
type BattleBuketAgentResult = {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  changedFiles: string[];
  verification: { name: string; passed: boolean; output?: string }[];
};

interface Window {
  battleBuket?: {
    getVersion: () => Promise<string>;
    getActiveWorkspace: () => Promise<string | null>;
    selectWorkspace: () => Promise<string | null>;
    getRecentWorkspaces: () => Promise<BattleBuketRecentWorkspace[]>;
    openRecentWorkspace: (path: string) => Promise<string>;
    listWorkspace: (path?: string) => Promise<BattleBuketWorkspaceEntry[]>;
    searchWorkspaceFiles: (query: string) => Promise<BattleBuketWorkspaceEntry[]>;
    searchWorkspaceContent: (query: string) => Promise<BattleBuketWorkspaceContentMatch[]>;
    readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; mtimeMs: number }>;
    saveWorkspaceFile: (payload: { path: string; content: string; expectedMtimeMs: number }) => Promise<{ path: string; mtimeMs: number }>;
    readWorkspaceFileSystemFile: (path: string) => Promise<{ path: string; content: Uint8Array; mtimeMs: number; size: number }>;
    writeWorkspaceFileSystemFile: (payload: { path: string; content: Uint8Array; create: boolean; overwrite: boolean }) => Promise<{ path: string; mtimeMs: number }>;
    createWorkspaceDirectory: (path: string) => Promise<boolean>;
    deleteWorkspacePath: (path: string, recursive: boolean) => Promise<boolean>;
    renameWorkspacePath: (oldPath: string, newPath: string, overwrite: boolean) => Promise<boolean>;
    getAgentAvailability: () => Promise<Record<BattleBuketProvider, boolean>>;
    getTaskHistory: () => Promise<BattleBuketTaskHistoryItem[]>;
    startTerminal: () => Promise<string>;
    writeTerminal: (sessionId: string, input: string) => Promise<boolean>;
    closeTerminal: (sessionId: string) => Promise<boolean>;
    resizeTerminal: (sessionId: string, columns: number, rows: number) => Promise<boolean>;
    onWorkspaceFileSystemChange: (listener: (event: { path: string; eventType: string }) => void) => () => void;
    onTerminalEvent: (listener: (event: BattleBuketTerminalEvent) => void) => () => void;
    runAgent: (payload: { prompt: string; provider: BattleBuketProvider; risk: BattleBuketTaskRisk }) => Promise<BattleBuketAgentResult>;
    cancelAgent: () => Promise<boolean>;
    onAgentEvent: (listener: (event: BattleBuketAgentEvent) => void) => () => void;
  };
}
