import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import Editor from "@monaco-editor/react";
import { VscodeWorkbench } from "./VscodeWorkbench";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Activity, Bot, Braces, CheckCircle2, ChevronDown, Command, FileCode2, Folder, FolderOpen, GitBranch, LayoutDashboard, Loader2, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Workflow, XCircle } from "lucide-react";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number; mtimeMs: number };
type WorkspaceContentMatch = { path: string; lineNumber: number; preview: string };
type RecentWorkspace = { path: string; lastOpenedAt: string };
type EditorTab = { path: string; content: string; mtimeMs: number; draft: string };
type EditorDiagnostic = { message: string; line: number; column: number; severity: number };
type EditorJump = { path: string; lineNumber: number };
type AgentProvider = "codex" | "claude";
type TaskRisk = "low" | "medium" | "high";
type AgentEvent = {
  type: "message" | "progress" | "file-change" | "command" | "warning" | "error" | "completed";
  taskId: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
};
type TaskHistoryItem = {
  taskId: string;
  provider: AgentProvider;
  risk: TaskRisk;
  title?: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  changedFileCount?: number;
  verificationPassed?: boolean;
};
type TerminalSessionEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  text?: string;
  exitCode?: number | null;
  signal?: number;
};
type AgentResult = {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  changedFiles: string[];
  verification: { name: string; passed: boolean; output?: string }[];
};
declare global {
  interface Window {
    battleBuket?: {
      getVersion: () => Promise<string>;
      getActiveWorkspace: () => Promise<string | null>;
      selectWorkspace: () => Promise<string | null>;
      getRecentWorkspaces: () => Promise<RecentWorkspace[]>;
      openRecentWorkspace: (path: string) => Promise<string>;
      listWorkspace: (path?: string) => Promise<WorkspaceEntry[]>;
      searchWorkspaceFiles: (query: string) => Promise<WorkspaceEntry[]>;
      searchWorkspaceContent: (query: string) => Promise<WorkspaceContentMatch[]>;
      readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; mtimeMs: number }>;
      saveWorkspaceFile: (payload: { path: string; content: string; expectedMtimeMs: number }) => Promise<{ path: string; mtimeMs: number }>;
      readWorkspaceFileSystemFile: (path: string) => Promise<{ path: string; content: Uint8Array; mtimeMs: number; size: number }>;
      writeWorkspaceFileSystemFile: (payload: { path: string; content: Uint8Array; create: boolean; overwrite: boolean }) => Promise<{ path: string; mtimeMs: number }>;
      createWorkspaceDirectory: (path: string) => Promise<boolean>;
      deleteWorkspacePath: (path: string, recursive: boolean) => Promise<boolean>;
      renameWorkspacePath: (oldPath: string, newPath: string, overwrite: boolean) => Promise<boolean>;
      getAgentAvailability: () => Promise<Record<AgentProvider, boolean>>;
      getTaskHistory: () => Promise<TaskHistoryItem[]>;
      startTerminal: () => Promise<string>;
      writeTerminal: (sessionId: string, input: string) => Promise<boolean>;
      closeTerminal: (sessionId: string) => Promise<boolean>;
      resizeTerminal: (sessionId: string, columns: number, rows: number) => Promise<boolean>;
      onTerminalEvent: (listener: (event: TerminalSessionEvent) => void) => () => void;
      runAgent: (payload: { prompt: string; provider: AgentProvider; risk: TaskRisk }) => Promise<AgentResult>;
      cancelAgent: () => Promise<boolean>;
      onAgentEvent: (listener: (event: AgentEvent) => void) => () => void;
      onWorkspaceFileSystemChange: (listener: (event: { path: string; eventType: string }) => void) => () => void;
    };
  }
}

function editorLanguageForPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  const languages: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json", py: "python", pyw: "python", rs: "rust", go: "go", java: "java",
    c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
    html: "html", htm: "html", xml: "xml", svg: "xml", css: "css", scss: "scss", less: "less",
    yaml: "yaml", yml: "yaml", md: "markdown", mdx: "markdown", sh: "shell", bash: "shell", zsh: "shell",
    ps1: "powershell", sql: "sql", graphql: "graphql", gql: "graphql", toml: "ini", ini: "ini",
    dockerfile: "dockerfile", makefile: "makefile", diff: "diff", txt: "plaintext", log: "log"
  };
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith("/dockerfile") || lowerPath === "dockerfile") return "dockerfile";
  if (lowerPath.endsWith("/makefile") || lowerPath === "makefile") return "makefile";
  return languages[extension] ?? "plaintext";
}

export default function App() {
  const [version, setVersion] = useState("dev");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [currentDirectory, setCurrentDirectory] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; mtimeMs: number } | null>(null);
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [editorDiagnostics, setEditorDiagnostics] = useState<EditorDiagnostic[]>([]);
  const [pendingEditorJump, setPendingEditorJump] = useState<EditorJump | null>(null);
  const editorRef = useRef<{ revealLineInCenter(lineNumber: number): void; setPosition(position: { lineNumber: number; column: number }): void; focus(): void } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const handleWorkbenchError = useCallback((message: string) => setError(message), []);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [risk, setRisk] = useState<TaskRisk>("low");
  const [availability, setAvailability] = useState<Record<AgentProvider, boolean>>({ codex: false, claude: false });
  const [running, setRunning] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [taskResult, setTaskResult] = useState<AgentResult | null>(null);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"files" | "content" | "commands">("files");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [quickOpenResults, setQuickOpenResults] = useState<WorkspaceEntry[]>([]);
  const [contentSearchResults, setContentSearchResults] = useState<WorkspaceContentMatch[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<"closed" | "starting" | "running" | "exited">("closed");
  const terminalSessionRef = useRef<string | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pendingTerminalEventsRef = useRef<TerminalSessionEvent[]>([]);

  const refreshFiles = async (directory = currentDirectory) => {
    try {
      setLoading(true); setError("");
      const files = await window.battleBuket?.listWorkspace(directory);
      setEntries(files ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not list project files"); }
    finally { setLoading(false); }
  };
  const openWorkspace = async () => {
    try {
      if (editorTabs.some(tab => tab.draft !== tab.content) &&
          !window.confirm("Discard unsaved changes before opening another project?")) return;
      setError("");
      const selected = await window.battleBuket?.selectWorkspace();
      if (selected) {
        setWorkspace(selected); setCurrentDirectory(""); setSelectedFile(null); setEditorTabs([]); setDraft(""); setEditorDiagnostics([]); setTaskResult(null); setDataConsent(false);
        await refreshFiles("");
        await refreshRecentWorkspaces();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open project folder"); }
  };
  const refreshHistory = async () => {
    try {
      const items = await window.battleBuket?.getTaskHistory();
      setTaskHistory(items ?? []);
    } catch { /* History is optional; a failed read must not block editing. */ }
  };

  const refreshRecentWorkspaces = async () => {
    try {
      const items = await window.battleBuket?.getRecentWorkspaces();
      setRecentWorkspaces(items ?? []);
    } catch { /* Recent projects are optional; opening a new folder must still work. */ }
  };

  const openRecentProject = async (path: string) => {
    try {
      if (editorTabs.some(tab => tab.draft !== tab.content) &&
          !window.confirm("Discard unsaved changes before switching projects?")) return;
      const selected = await window.battleBuket?.openRecentWorkspace(path);
      if (!selected) return;
      setWorkspace(selected);
      setCurrentDirectory("");
      setSelectedFile(null);
      setEditorTabs([]);
      setDraft("");
      setEditorDiagnostics([]);
      setTaskResult(null);
      setDataConsent(false);
      await refreshFiles("");
      await refreshRecentWorkspaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen recent project");
      await refreshRecentWorkspaces();
    }
  };
  const openFile = async (path: string) => {
    try {
      setError("");
      const cached = editorTabs.find(tab => tab.path === path);
      if (cached) {
        setSelectedFile({ path: cached.path, content: cached.content, mtimeMs: cached.mtimeMs });
        setEditorDiagnostics([]);
        setDraft(cached.draft);
        setSaveMessage(cached.draft !== cached.content ? "Unsaved changes" : "");
        return;
      }
      const file = await window.battleBuket?.readWorkspaceFile(path);
      if (file) {
        const tab: EditorTab = { ...file, draft: file.content };
        setEditorTabs(current => current.some(item => item.path === file.path) ? current : [...current, tab]);
        setSelectedFile(file);
        setEditorDiagnostics([]);
        setDraft(file.content);
        setSaveMessage("");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read file"); }
  };
  const openContentMatch = (match: WorkspaceContentMatch) => {
    setPendingEditorJump({ path: match.path, lineNumber: match.lineNumber });
    setPaletteOpen(false);
    void openFile(match.path);
  };
  const activateEditorTab = (tab: EditorTab) => {
    setSelectedFile({ path: tab.path, content: tab.content, mtimeMs: tab.mtimeMs });
    setEditorDiagnostics([]);
    setDraft(tab.draft);
    setSaveMessage(tab.draft !== tab.content ? "Unsaved changes" : "");
  };
  const closeEditorTab = (path: string) => {
    const tab = editorTabs.find(item => item.path === path);
    if (!tab) return;
    if (tab.draft !== tab.content && !window.confirm("Discard unsaved changes in " + path + "?")) return;
    const nextTabs = editorTabs.filter(item => item.path !== path);
    setEditorTabs(nextTabs);
    if (selectedFile?.path === path) {
      const next = nextTabs[nextTabs.length - 1];
      if (next) activateEditorTab(next);
      else { setSelectedFile(null); setDraft(""); setSaveMessage(""); }
    }
  };
  const saveFile = async () => {
    if (!selectedFile || !window.battleBuket) return;
    try {
      setSaving(true); setError("");
      const saved = await window.battleBuket.saveWorkspaceFile({ path: selectedFile.path, content: draft, expectedMtimeMs: selectedFile.mtimeMs });
      const nextFile = { ...selectedFile, content: draft, mtimeMs: saved.mtimeMs };
      setSelectedFile(nextFile);
      setEditorTabs(current => current.map(tab => tab.path === selectedFile.path ? { ...tab, content: draft, draft, mtimeMs: saved.mtimeMs } : tab));
      setSaveMessage("Saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };
  const openPalette = (mode: "files" | "content" | "commands") => {
    setPaletteMode(mode);
    setPaletteQuery("");
    setQuickOpenResults([]);
    setContentSearchResults([]);
    setPaletteIndex(0);
    setPaletteOpen(true);
  };
  const runPaletteCommand = (id: string) => {
    setPaletteOpen(false);
    switch (id) {
      case "open-project": void openWorkspace(); break;
      case "quick-open": openPalette("files"); break;
      case "find-in-files": openPalette("content"); break;
      case "toggle-terminal":
        if (terminalOpen) setTerminalOpen(false);
        else void openTerminal();
        break;
      case "save-file": void saveFile(); break;
      case "refresh-files": void refreshFiles(); break;
      case "cancel-task": void cancelTask(); break;
    }
  };
  const startTask = async () => {
    if (!window.battleBuket || !workspace) { setError("Open a project folder before starting a task."); return; }
    if (!dataConsent) { setError("Confirm the provider data-sharing notice before starting a task."); return; }
    if (prompt.trim().length < 3) { setError("Describe the task you want the agent to complete."); return; }
    if (!availability[provider]) { setError(provider === "codex" ? "Codex CLI 0.171.0 or newer is required. Install or update it and sign in on this computer." : "Claude Agent SDK is unavailable. Check sandbox support, runtime installation, and account authentication."); return; }
    try {
      setError(""); setRunning(true); setTaskResult(null); setAgentEvents([]);
      const result = await window.battleBuket.runAgent({ prompt: prompt.trim(), provider, risk });
      setTaskResult(result);
      if (result.status === "succeeded") await refreshFiles("");
    } catch (e) { setError(e instanceof Error ? e.message : "The engineering task failed to start"); }
    finally { setRunning(false); void refreshHistory(); }
  };
  const applyTerminalEvent = (event: TerminalSessionEvent) => {
    if (terminalSessionRef.current !== event.sessionId) {
      if (!terminalSessionRef.current && pendingTerminalEventsRef.current.length < 500) {
        pendingTerminalEventsRef.current.push(event);
      }
      return;
    }
    const terminal = terminalRef.current;
    if (!terminal) {
      if (pendingTerminalEventsRef.current.length < 500) pendingTerminalEventsRef.current.push(event);
      return;
    }
    if (event.type === "output" && event.text) {
      terminal?.write(event.text);
    } else if (event.type === "error") {
      terminal?.writeln("\r\n\x1b[31m[terminal error] " + (event.text ?? "Unknown terminal error") + "\x1b[0m");
    } else if (event.type === "exit") {
      terminal?.writeln("\r\n\x1b[90m[process exited: " + String(event.exitCode ?? "unknown") + "]\x1b[0m");
      terminalSessionRef.current = null;
      setTerminalSessionId(null);
      setTerminalStatus("exited");
    }
  };

  const openTerminal = async () => {
    setTerminalOpen(true);
    if (!window.battleBuket || !workspace) { setError("Open a project folder before starting the terminal."); return; }
    if (terminalStatus === "starting" || terminalSessionRef.current) return;
    try {
      setTerminalStatus("starting");
      pendingTerminalEventsRef.current = [];
      const id = await window.battleBuket.startTerminal();
      terminalSessionRef.current = id;
      setTerminalSessionId(id);
      setTerminalStatus("running");
      const buffered = pendingTerminalEventsRef.current;
      pendingTerminalEventsRef.current = [];
      for (const event of buffered) {
        if (event.sessionId === id) applyTerminalEvent(event);
      }
      requestAnimationFrame(() => {
        const addon = fitAddonRef.current;
        const terminal = terminalRef.current;
        if (addon && terminal && terminalHostRef.current) {
          try {
            addon.fit();
            void window.battleBuket?.resizeTerminal(id, terminal.cols, terminal.rows).catch(error => {
              terminal.writeln("\r\n\x1b[31m[resize failed] " + String(error) + "\x1b[0m");
            });
          } catch { /* The terminal host may not have completed layout yet. */ }
          terminal.focus();
        }
      });
    } catch (e) {
      terminalSessionRef.current = null;
      setTerminalSessionId(null);
      setTerminalStatus("closed");
      terminalRef.current?.writeln("\r\n\x1b[31m[unable to start terminal] " + (e instanceof Error ? e.message : "Unknown error") + "\x1b[0m");
    }
  };

  const closeTerminal = async () => {
    const id = terminalSessionRef.current;
    if (id && window.battleBuket) {
      try { await window.battleBuket.closeTerminal(id); }
      catch (e) { terminalRef.current?.writeln("\r\n\x1b[31m[close failed] " + (e instanceof Error ? e.message : "Unknown error") + "\x1b[0m"); }
    }
    terminalSessionRef.current = null;
    pendingTerminalEventsRef.current = [];
    setTerminalSessionId(null);
    setTerminalStatus("closed");
  };

  const cancelTask = async () => {
    try { await window.battleBuket?.cancelAgent(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not cancel the task"); }
  };

  useEffect(() => {
    window.battleBuket?.getVersion().then(setVersion).catch(() => {});
    window.battleBuket?.getAgentAvailability().then(setAvailability).catch(() => {});
    window.battleBuket?.getActiveWorkspace().then(selected => {
      if (!selected) return;
      setWorkspace(selected);
      setCurrentDirectory("");
      void refreshFiles("");
    }).catch(() => {});
    void refreshHistory();
    void refreshRecentWorkspaces();
    const unsubscribe = window.battleBuket?.onAgentEvent(event => {
      setAgentEvents(current => [...current, event].slice(-80));
    });
    const unsubscribeTerminal = window.battleBuket?.onTerminalEvent(event => applyTerminalEvent(event));
    return () => { unsubscribe?.(); unsubscribeTerminal?.(); };
  }, []);

  useEffect(() => {
    if (!paletteOpen || (paletteMode !== "files" && paletteMode !== "content") || !workspace || !paletteQuery.trim()) {
      setQuickOpenResults([]);
      setContentSearchResults([]);
      setPaletteLoading(false);
      return;
    }
    let cancelled = false;
    setQuickOpenResults([]);
    setContentSearchResults([]);
    const timer = window.setTimeout(() => {
      setPaletteLoading(true);
      const search = paletteMode === "files"
        ? window.battleBuket?.searchWorkspaceFiles(paletteQuery)
        : window.battleBuket?.searchWorkspaceContent(paletteQuery);
      void search?.then(results => {
        if (cancelled) return;
        if (paletteMode === "files") setQuickOpenResults(results as WorkspaceEntry[]);
        else setContentSearchResults(results as WorkspaceContentMatch[]);
        setPaletteIndex(0);
      }).catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Workspace search failed");
      }).finally(() => {
        if (!cancelled) setPaletteLoading(false);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [paletteOpen, paletteMode, paletteQuery, workspace]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteQuery, paletteMode]);

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && paletteOpen) {
        event.preventDefault();
        event.stopPropagation();
        setPaletteOpen(false);
        return;
      }
      const commandKey = event.ctrlKey || event.metaKey;
      if (!commandKey) return;
      if (workspace) {
        if (!event.shiftKey && event.key.toLowerCase() === "j") {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new Event("battlebuket:toggle-terminal"));
        }
        return;
      }
      if (!event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        if (selectedFile && !saving) void saveFile();
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openPalette("content");
      } else if (event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        openPalette("commands");
      } else if (!event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        openPalette("files");
      } else if (!event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalOpen) setTerminalOpen(false);
        else void openTerminal();
      }
    };
    window.addEventListener("keydown", onGlobalShortcut, true);
    return () => window.removeEventListener("keydown", onGlobalShortcut, true);
  }, [terminalOpen, workspace, terminalStatus, paletteOpen, selectedFile, saving, draft]);

  useEffect(() => {
    if (!pendingEditorJump || selectedFile?.path !== pendingEditorJump.path || !editorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenter(pendingEditorJump.lineNumber);
      editor.setPosition({ lineNumber: pendingEditorJump.lineNumber, column: 1 });
      editor.focus();
      setPendingEditorJump(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingEditorJump, selectedFile?.path]);

  useEffect(() => {
    const hasUnsavedChanges = editorTabs.some(tab => tab.draft !== tab.content);
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [editorTabs]);

  useEffect(() => {
    if (!(terminalOpen || Boolean(terminalSessionId)) || !terminalHostRef.current || terminalRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontSize: 12,
      fontFamily: "'DM Mono', ui-monospace, SFMono-Regular, monospace",
      theme: {
        background: "#080b10",
        foreground: "#c8d3e5",
        cursor: "#a99aff",
        selectionBackground: "#554a91",
        black: "#080b10",
        red: "#ff9b9b",
        green: "#69d5a5",
        yellow: "#d6ad6e",
        blue: "#879bff",
        magenta: "#b09cff",
        cyan: "#79c6d8",
        white: "#e8edf7"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const onData = terminal.onData(data => {
      const id = terminalSessionRef.current;
      if (!id) return;
      void window.battleBuket?.writeTerminal(id, data).catch(error => {
        terminal.writeln("\r\n\x1b[31m[input failed] " + String(error) + "\x1b[0m");
      });
    });
    const onResize = terminal.onResize(size => {
      const id = terminalSessionRef.current;
      if (!id) return;
      void window.battleBuket?.resizeTerminal(id, size.cols, size.rows).catch(error => {
        terminal.writeln("\r\n\x1b[31m[resize failed] " + String(error) + "\x1b[0m");
      });
    });
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* Ignore transient zero-sized layout. */ }
    });
    observer.observe(terminalHostRef.current);
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* Ignore transient zero-sized layout. */ }
      terminal.focus();
    });

    const buffered = pendingTerminalEventsRef.current;
    pendingTerminalEventsRef.current = [];
    for (const event of buffered) applyTerminalEvent(event);

    return () => {
      observer.disconnect();
      onData.dispose();
      onResize.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalOpen || Boolean(terminalSessionId)]);

  const workspaceName = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : "Director workspace";
  const activeProviderName = provider === "codex" ? "Codex" : "Claude";

  const quickCommands = [
    { id: "open-project", label: "Open Project", description: "Choose a workspace folder" },
    { id: "quick-open", label: "Quick Open File", description: "Search files in the selected workspace · Ctrl/Cmd+P" },
    { id: "find-in-files", label: "Find in Files", description: "Search text in project files · Ctrl/Cmd+Shift+F" },
    { id: "toggle-terminal", label: "Toggle Integrated Terminal", description: "Show or hide the PTY terminal" },
    { id: "save-file", label: "Save Active File", description: "Write the current editor tab" },
    { id: "refresh-files", label: "Refresh Project Explorer", description: "Reload the workspace file tree" },
    { id: "cancel-task", label: "Cancel Active Task", description: "Stop provider execution or verification" }
  ].filter(command => command.id !== "save-file" || Boolean(selectedFile))
   .filter(command => command.id !== "cancel-task" || running)
   .filter(command => command.id !== "toggle-terminal" || Boolean(workspace))
   .filter(command => command.id !== "refresh-files" || Boolean(workspace));
  const filteredCommands = quickCommands.filter(command =>
    (command.label + " " + command.description).toLowerCase().includes(paletteQuery.toLowerCase())
  );
  const paletteCount = paletteMode === "files" ? quickOpenResults.length : paletteMode === "content" ? contentSearchResults.length : filteredCommands.length;
  const activatePaletteSelection = () => {
    if (paletteMode === "commands") {
      const command = filteredCommands[paletteIndex];
      if (command) runPaletteCommand(command.id);
    } else if (paletteMode === "files") {
      const file = quickOpenResults[paletteIndex];
      if (file) {
        setPaletteOpen(false);
        void openFile(file.path);
      }
    } else {
      const match = contentSearchResults[paletteIndex];
      if (match) openContentMatch(match);
    }
  };

  return <main className="shell">
    <header className="top">
      <div className="brand"><span className="mark"><Braces size={17}/></span>BATTLEBUKET <b>CODES</b><small>ENGINEERING WORKSPACE</small></div>
      <button className="workspace-name" onClick={openWorkspace} disabled={running} title="Choose or switch project"><i/> {workspaceName} <ChevronDown size={13}/></button>
      <div className="top-right">v{version}<Settings2 size={16}/></div>
    </header>
    <div className="layout">
      <nav className={workspace ? "rail rail-hidden" : "rail"}><LayoutDashboard/><FolderOpen/><button className="rail-action" title="Find in Files · Ctrl/Cmd+Shift+F" onClick={() => openPalette("content")}><Search/></button><button className="rail-action" title="Command Palette · Ctrl/Cmd+Shift+P" onClick={() => openPalette("commands")}><Command/></button><GitBranch/><span/><ShieldCheck/></nav>
      <aside className={workspace ? "projects projects-hidden" : "projects"}>
        <label>PROJECT EXPLORER</label>
        <button onClick={openWorkspace} disabled={running}><FolderOpen size={15}/> {workspace ? "Change project" : "Open project"} <Plus size={13}/></button>
        {workspace && <div className="file-list">
          <div className="file-heading" onClick={() => { setCurrentDirectory(""); void refreshFiles(""); }}><Folder size={13}/> {currentDirectory || workspaceName} <span>↻</span></div>
          {loading && <small>Loading files…</small>}
          {currentDirectory && <button className="file-entry" onClick={() => { const parent = currentDirectory.split(/[\\/]/).slice(0,-1).join("/"); setCurrentDirectory(parent); void refreshFiles(parent); }}>↰ <span>..</span></button>}
          {entries.map(entry => <button className="file-entry" key={entry.path} onClick={() => {
            if (entry.kind === "file") void openFile(entry.path);
            else { setCurrentDirectory(entry.path); void refreshFiles(entry.path); }
          }}>
            {entry.kind === "directory" ? <Folder size={13}/> : <FileCode2 size={13}/>}<span>{entry.name}</span>
          </button>)}
          {entries.length === 0 && !loading && <small>No visible files in this folder.</small>}
        </div>}
        {!workspace && <div className="empty"><FileCode2 size={26}/><b>Your workspace starts here</b><p>Open a project folder to browse files and preview source code.</p><button className="open" onClick={openWorkspace} disabled={running}><Plus size={14}/> Open project</button></div>}
        {recentWorkspaces.filter(project => project.path !== workspace).length > 0 && <div className="recent-projects">
          <label>RECENT PROJECTS</label>
          {recentWorkspaces.filter(project => project.path !== workspace).map(project => <button key={project.path} title={project.path} onClick={() => void openRecentProject(project.path)}>
            <Folder size={13}/><span>{project.path.split(/[\\/]/).filter(Boolean).pop() || project.path}</span>
            <small>{new Date(project.lastOpenedAt).toLocaleDateString()}</small>
          </button>)}
        </div>}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <footer>● Local workspace · {workspace ? "Connected" : "Ready"}</footer>
      </aside>
      <section className="center">
        <div className="tab"><FileCode2 size={14}/> {workspace ? workspaceName + " · VS Code Workbench" : selectedFile ? selectedFile.path : "Engineering command center"}<button className="terminal-toggle" onClick={() => { if (workspace) window.dispatchEvent(new Event("battlebuket:toggle-terminal")); else if (terminalOpen) setTerminalOpen(false); else void openTerminal(); }}>{workspace ? "Terminal" : terminalOpen ? "Hide terminal" : "Terminal"}</button></div>
        {workspace
          ? <VscodeWorkbench workspacePath={workspace} onError={handleWorkbenchError}/>
          : <>
        {paletteOpen && <div className="palette-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <section className="palette-dialog" role="dialog" aria-modal="true" aria-label={paletteMode === "files" ? "Quick Open" : paletteMode === "content" ? "Find in Files" : "Command Palette"}>
            <div className="palette-input-row">
              {paletteMode === "commands" ? <Command size={16}/> : <Search size={16}/>}
              <input
                autoFocus
                value={paletteQuery}
                onChange={event => setPaletteQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Escape") { event.preventDefault(); setPaletteOpen(false); }
                  else if (event.key === "ArrowDown") { event.preventDefault(); setPaletteIndex(index => paletteCount ? (index + 1) % paletteCount : 0); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); setPaletteIndex(index => paletteCount ? (index - 1 + paletteCount) % paletteCount : 0); }
                  else if (event.key === "Enter") { event.preventDefault(); activatePaletteSelection(); }
                }}
                placeholder={paletteMode === "files" ? "Search files by name…" : paletteMode === "content" ? "Find text in project files…" : "Type a command…"}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette-caption">{paletteMode === "files" ? "QUICK OPEN · FILE NAMES" : paletteMode === "content" ? "FIND IN FILES · CONTENT SEARCH" : "COMMAND PALETTE · ACTIONS"}</div>
            <div className="palette-results">
              {paletteMode === "files"
                ? quickOpenResults.map((file, index) => <button key={file.path} className={index === paletteIndex ? "selected" : ""} onMouseEnter={() => setPaletteIndex(index)} onClick={() => { setPaletteOpen(false); void openFile(file.path); }}>
                    <FileCode2 size={13}/><span>{file.path}</span><small>{Math.ceil(file.size / 1024)} KB</small>
                  </button>)
                : paletteMode === "content"
                  ? contentSearchResults.map((match, index) => <button key={match.path + ":" + match.lineNumber} className={index === paletteIndex ? "selected" : ""} onMouseEnter={() => setPaletteIndex(index)} onClick={() => openContentMatch(match)}>
                      <FileCode2 size={13}/><span>{match.path}:{match.lineNumber} · {match.preview}</span>
                    </button>)
                  : filteredCommands.map((command, index) => <button key={command.id} className={index === paletteIndex ? "selected" : ""} onMouseEnter={() => setPaletteIndex(index)} onClick={() => runPaletteCommand(command.id)}>
                      <Command size={13}/><span>{command.label}</span><small>{command.description}</small>
                    </button>)}
              {paletteLoading && <p>Searching workspace…</p>}
              {!paletteLoading && paletteCount === 0 && <p>{paletteMode === "files" ? (!workspace ? "Open a project folder before searching files." : paletteQuery.trim() ? "No matching file names found." : "Type part of a file name to search the workspace.") : paletteMode === "content" ? (!workspace ? "Open a project folder before searching content." : paletteQuery.trim().length < 2 ? "Type at least two characters to search file contents." : "No matching text found in searchable files.") : "No commands match your search."}</p>}
            </div>
            <div className="palette-footer">{paletteMode === "files" ? "Ctrl/Cmd + P" : paletteMode === "content" ? "Ctrl/Cmd + Shift + F" : "Ctrl/Cmd + Shift + P"} · ↑ ↓ Navigate · Enter Open · Esc Close</div>
          </section>
        </div>}
        {editorTabs.length > 0 && <div className="editor-tabs" role="tablist" aria-label="Open files">
          {editorTabs.map(tab => <div key={tab.path} className={"editor-tab" + (selectedFile?.path === tab.path ? " active" : "")}>
            <button className="editor-tab-name" role="tab" aria-selected={selectedFile?.path === tab.path} onClick={() => activateEditorTab(tab)}>
              <FileCode2 size={12}/><span>{tab.path.split(/[\\/]/).pop()}</span>{tab.draft !== tab.content && <i aria-label="Unsaved changes"/>}
            </button>
            <button className="editor-tab-close" aria-label={"Close " + tab.path} onClick={() => closeEditorTab(tab.path)}>×</button>
          </div>)}
        </div>}
        {selectedFile ? <div className="editor-preview">
          <div className="editor-toolbar">
            <span className="editor-file-path">{selectedFile.path}</span>
            <span>{saveMessage || (draft !== selectedFile.content ? "Unsaved changes" : "Monaco · 1 MB file limit")}</span>
            <button onClick={saveFile} disabled={saving || draft === selectedFile.content}>{saving ? "Saving…" : "Save"}</button>
          </div>
          <div className="monaco-editor-host">
            <Editor
              height="100%"
              path={selectedFile.path}
              language={editorLanguageForPath(selectedFile.path)}
              theme="vs-dark"
              onMount={editor => {
                editorRef.current = editor;
                const pending = pendingEditorJump;
                if (pending?.path === selectedFile.path) {
                  requestAnimationFrame(() => {
                    editor.revealLineInCenter(pending.lineNumber);
                    editor.setPosition({ lineNumber: pending.lineNumber, column: 1 });
                    editor.focus();
                    setPendingEditorJump(current => current?.path === pending.path ? null : current);
                  });
                }
              }}
              value={draft}
              onChange={value => { const nextDraft = value ?? ""; setDraft(nextDraft); setEditorTabs(current => current.map(tab => tab.path === selectedFile.path ? { ...tab, draft: nextDraft } : tab)); setSaveMessage(""); }}
              onValidate={markers => setEditorDiagnostics(markers.map(marker => ({
                message: marker.message,
                line: marker.startLineNumber,
                column: marker.startColumn,
                severity: marker.severity
              })))}
              options={{
                automaticLayout: true,
                minimap: { enabled: true, scale: 1 },
                fontFamily: "'DM Mono', 'Cascadia Code', ui-monospace, monospace",
                fontSize: 13,
                fontLigatures: true,
                lineNumbers: "on",
                renderWhitespace: "selection",
                scrollBeyondLastLine: false,
                wordWrap: "off",
                tabSize: 2,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                padding: { top: 12, bottom: 12 },
                overviewRulerBorder: false,
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
              }}
            />
          </div>
          <section className="problems-panel" aria-label="Editor diagnostics">
            <div className="problems-heading"><span>PROBLEMS</span><small>{editorDiagnostics.length} {editorDiagnostics.length === 1 ? "issue" : "issues"}</small></div>
            {editorDiagnostics.length === 0
              ? <p className="problems-empty">No editor diagnostics for this file.</p>
              : <div className="problems-list">
                  {editorDiagnostics.slice(0, 100).map((diagnostic, index) => <button className="problem-item" type="button" key={diagnostic.line + ":" + diagnostic.column + ":" + index} onClick={() => {
                    setPendingEditorJump({ path: selectedFile.path, lineNumber: diagnostic.line });
                    editorRef.current?.focus();
                  }}>
                    <span className={diagnostic.severity === 8 ? "problem-error" : diagnostic.severity === 4 ? "problem-warning" : "problem-info"}>{diagnostic.severity === 8 ? "ERROR" : diagnostic.severity === 4 ? "WARNING" : "INFO"}</span>
                    <span className="problem-message">{diagnostic.message}</span>
                    <small>{diagnostic.line}:{diagnostic.column}</small>
                  </button>)}
                </div>}
          </section>
        </div> : <article>
          <label className="eyebrow">AUTONOMOUS ENGINEERING WORKSPACE</label>
          <h1>Build something<br/><em>extraordinary.</em></h1>
          <p className="sub">Give the Engineering Director a task. It will run a connected provider inside your selected project workspace.</p>
          <div className="task-composer">
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe what you want to build, fix, or investigate…" disabled={running}/>
            <div className="composer-controls">
              <label>ENGINE</label>
              <select value={provider} onChange={event => { setProvider(event.target.value as AgentProvider); setDataConsent(false); }} disabled={running}>
                <option value="codex">Codex {availability.codex ? "· Ready" : "· Unavailable"}</option>
                <option value="claude">Claude {availability.claude ? "· Ready" : "· Unavailable"}</option>
              </select>
              <label>PERMISSION</label>
              <select value={risk} onChange={event => setRisk(event.target.value as TaskRisk)} disabled={running}>
                <option value="low">Low · read-only</option>
                <option value="medium">Medium · workspace edits</option>
                <option value="high">High · read-only + confirmation</option>
              </select>
              {running
                ? <button className="run-button cancel" onClick={cancelTask}><Square size={14}/> Cancel task</button>
                : <button className="run-button" onClick={startTask} disabled={!workspace || !availability[provider] || !dataConsent}><Sparkles size={15}/> Run task</button>}
            </div>
            <label className="data-consent">
              <input type="checkbox" checked={dataConsent} onChange={event => setDataConsent(event.target.checked)} disabled={running}/>
              <span>I understand that my task prompt and relevant project files may be sent to the selected provider for implementation and a second read-only review pass. The extra pass may consume additional provider usage or incur charges. I will not submit secrets or data I am not authorized to share.</span>
            </label>
            <div className="composer-hint">{!workspace ? "Open a project folder to enable engineering tasks." : !dataConsent ? "Confirm the provider data-sharing notice to enable Run task." : availability[provider] ? "Runtime detected · authentication is checked when the task starts; access stays restricted to the workspace." : "Selected provider runtime is not detected on this computer."}</div>
          </div>
          {running && <div className="run-panel"><div className="run-heading"><Loader2 className="spin"/><b>Engineering Director is supervising {activeProviderName}</b><span>RUNNING</span></div>
            <div className="event-feed">{agentEvents.slice(-8).map((event, index) => <p key={event.taskId + event.timestamp + index}><span>{new Date(event.timestamp).toLocaleTimeString()}</span>{event.message}</p>)}</div>
          </div>}
          {taskResult && <div className="result-panel">
            <div className="result-heading">{taskResult.status === "succeeded" ? <CheckCircle2/> : <XCircle/>}<b>Task {taskResult.status}</b><span>{taskResult.changedFiles.length} changed files</span></div>
            <p>{taskResult.summary}</p>
            {taskResult.changedFiles.length > 0 && <div className="changed-files">{taskResult.changedFiles.map(file => <span key={file}><FileCode2 size={12}/>{file}</span>)}</div>}
            {taskResult.verification.map(check => <div className="verification" key={check.name}><span>{check.passed ? "✓" : "×"} {check.name}</span><small>{check.output}</small></div>)}
          </div>}
          <div className="cards">
            <div><Bot/><b>Engineering Director</b><p>Routes one active task to the selected provider and applies a verification gate.</p><small>● Execution pipeline connected</small></div>
            <div><Activity/><b>Provider runtimes</b><p>Uses locally installed Codex CLI or Claude Agent SDK runtime and your own authentication.</p><small className={availability.codex || availability.claude ? "" : "pending"}>● {availability.codex || availability.claude ? "At least one provider detected" : "No provider detected"}</small></div>
            <div><ShieldCheck/><b>Workspace safety</b><p>Scoped file access, bounded previews, stale-save protection, and no full-access agent mode.</p><small>● Restricted workspace access</small></div>
            <div><Workflow/><b>Quality gate</b><p>Per-task verification runs approved project test/lint/typecheck/build scripts and supported dependency audits, then checks staged and unstaged Git diffs. Scripts still run with OS-user permissions, not in a dedicated sandbox.</p><small className="pending">Partial verification only</small></div>
          </div>
          <p className="prototype-note">Engineering preview. Open a project to enter the embedded VS Code workbench. Provider tasks use your local login and the native integrated terminal runs with your OS account permissions. Authenticated provider and signed installer acceptance tests are still required before production use.</p>
        </article>}
          </>}
        {!workspace && (terminalOpen || terminalSessionId) && <section className={terminalOpen ? "terminal-panel" : "terminal-panel terminal-panel-hidden"}>
          <div className="terminal-title">
            <span>INTEGRATED TERMINAL · {workspaceName} · {terminalStatus.toUpperCase()}</span>
            <div>
              <button onClick={() => terminalRef.current?.clear()}>Clear</button>
              {terminalSessionId && <button onClick={() => void closeTerminal()}>Close session</button>}
              {terminalStatus === "exited" && <button onClick={() => void openTerminal()}>Restart</button>}
            </div>
          </div>
          <div ref={terminalHostRef} className="terminal-canvas" role="application" aria-label="Project terminal. Type commands here."/>
          <div className="terminal-footnote">Native PTY · Interactive shell · Runs with your OS account permissions</div>
        </section>}
      <footer className="status"><span><GitBranch size={12}/> main</span><span><ShieldCheck size={12}/> Guarded workspace file access · PTY runs with OS-user permissions</span><span>BattleBuket Codes · Engineering preview</span></footer>
      </section>
      <aside className="director">
        <label>● CONTROL PLANE</label><h3>Engineering Director</h3>
        <div className="director-card"><Bot/><div><b>{running ? "Supervising active task" : "Ready for a task"}</b><p>{workspace ? "Workspace: " + workspaceName : "Open a project to begin."}</p></div></div>
        {workspace && <section className="director-task-composer" aria-label="Engineering task composer">
          <label>ENGINEERING TASK</label>
          <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the feature, fix or investigation…" disabled={running}/>
          <label>ENGINE</label>
          <select value={provider} onChange={event => { setProvider(event.target.value as AgentProvider); setDataConsent(false); }} disabled={running}>
            <option value="codex">Codex {availability.codex ? "· Ready" : "· Unavailable"}</option>
            <option value="claude">Claude {availability.claude ? "· Ready" : "· Unavailable"}</option>
          </select>
          <label>PERMISSION</label>
          <select value={risk} onChange={event => setRisk(event.target.value as TaskRisk)} disabled={running}>
            <option value="low">Low · read-only</option>
            <option value="medium">Medium · workspace edits</option>
            <option value="high">High · approval required</option>
          </select>
          <label className="director-consent">
            <input type="checkbox" checked={dataConsent} onChange={event => setDataConsent(event.target.checked)} disabled={running}/>
            <span>Provider may receive the task and relevant project context. Additional review may consume usage. Do not share secrets.</span>
          </label>
          {running
            ? <button className="run-button cancel" onClick={cancelTask}><Square size={13}/> Cancel task</button>
            : <button className="run-button" onClick={startTask} disabled={!availability[provider] || !dataConsent || prompt.trim().length < 3}><Sparkles size={13}/> Run task</button>}
          {error && <p className="workspace-error" role="alert">{error}</p>}
          {running && <div className="event-feed">{agentEvents.slice(-4).map((event,index)=><p key={event.taskId+event.timestamp+index}><span>{new Date(event.timestamp).toLocaleTimeString()}</span>{event.message}</p>)}</div>}
          {taskResult && <div className="director-task-result"><b>Task {taskResult.status}</b><p>{taskResult.summary}</p><small>{taskResult.changedFiles.length} changed files · {taskResult.verification.filter(item=>item.passed).length}/{taskResult.verification.length} checks passed</small></div>}
        </section>}
        <h4>PROVIDER HEALTH</h4>
        <p className="gate">◈ Codex CLI <b className={availability.codex ? "" : "pending"}>{availability.codex ? "DETECTED" : "NOT FOUND"}</b></p>
        <p className="gate">◈ Claude runtime <b className={availability.claude ? "" : "pending"}>{availability.claude ? "DETECTED" : "NOT FOUND"}</b></p>
        <h4>TASK PIPELINE</h4>
        <p className="no-tasks">{running ? "1 task running" : taskResult ? "Last task: " + taskResult.status : "No active tasks"}<br/><small>One task at a time; progress events are streamed from the provider.</small></p>
        <h4>RECENT TASKS <span>{taskHistory.length}</span></h4>
        <div className="history-list">
          {taskHistory.slice(0, 5).map(item => <div className="history-item" key={item.taskId}>
            <span className={"history-status " + item.status}>{item.status}</span>
            <b>{item.title || ((item.provider === "codex" ? "Codex" : "Claude") + " · " + item.risk)}</b>
            <small>{new Date(item.startedAt).toLocaleString()} {item.changedFileCount !== undefined ? "· " + item.changedFileCount + " changed" : ""}</small>
          </div>)}
          {taskHistory.length === 0 && <p className="history-empty">Completed task summaries appear here. Prompts and model output are not stored.</p>}
        </div>
        <h4>QUALITY GATES</h4>
        <p className="gate">◈ Workspace boundary <b>ENFORCED</b></p>
        {taskResult && taskResult.verification.length > 0
          ? taskResult.verification.map((check, index) => <p className="gate" key={check.name + ":" + index} title={check.output || check.name}>
              ◈ {check.name}<b className={check.passed ? "" : "failed"}>{check.passed ? "PASSED" : "FAILED"}</b>
            </p>)
          : <p className="no-tasks"><small>{running ? "Quality checks run after implementation and review." : "Verification results appear here after a task completes."}</small></p>}
        <div className="note">✧ The app uses your local provider login. No model access or API credits are included. Review agent changes before release.</div>
      </aside>
    </div>
  </main>;
}
