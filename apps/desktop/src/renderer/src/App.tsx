import { useEffect, useState } from "react";
import { Activity, Bot, Braces, CheckCircle2, ChevronDown, Command, FileCode2, Folder, FolderOpen, GitBranch, LayoutDashboard, Loader2, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Workflow, XCircle } from "lucide-react";

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
      selectWorkspace: () => Promise<string | null>;
      listWorkspace: (path?: string) => Promise<WorkspaceEntry[]>;
      readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; mtimeMs: number }>;
      saveWorkspaceFile: (payload: { path: string; content: string; expectedMtimeMs: number }) => Promise<{ path: string; mtimeMs: number }>;
      getAgentAvailability: () => Promise<Record<AgentProvider, boolean>>;
      runAgent: (payload: { prompt: string; provider: AgentProvider; risk: TaskRisk }) => Promise<AgentResult>;
      cancelAgent: () => Promise<boolean>;
      onAgentEvent: (listener: (event: AgentEvent) => void) => () => void;
    };
  }
}

export default function App() {
  const [version, setVersion] = useState("dev");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [currentDirectory, setCurrentDirectory] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; mtimeMs: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [risk, setRisk] = useState<TaskRisk>("low");
  const [availability, setAvailability] = useState<Record<AgentProvider, boolean>>({ codex: false, claude: false });
  const [running, setRunning] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [taskResult, setTaskResult] = useState<AgentResult | null>(null);

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
      setError("");
      const selected = await window.battleBuket?.selectWorkspace();
      if (selected) {
        setWorkspace(selected); setCurrentDirectory(""); setSelectedFile(null); setTaskResult(null);
        await refreshFiles("");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open project folder"); }
  };
  const openFile = async (path: string) => {
    try {
      setError("");
      const file = await window.battleBuket?.readWorkspaceFile(path);
      if (file) { setSelectedFile(file); setDraft(file.content); setSaveMessage(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read file"); }
  };
  const saveFile = async () => {
    if (!selectedFile || !window.battleBuket) return;
    try {
      setSaving(true); setError("");
      const saved = await window.battleBuket.saveWorkspaceFile({ path: selectedFile.path, content: draft, expectedMtimeMs: selectedFile.mtimeMs });
      setSelectedFile({ ...selectedFile, content: draft, mtimeMs: saved.mtimeMs }); setSaveMessage("Saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };
  const startTask = async () => {
    if (!window.battleBuket || !workspace) { setError("Open a project folder before starting a task."); return; }
    if (prompt.trim().length < 3) { setError("Describe the task you want the agent to complete."); return; }
    if (!availability[provider]) { setError(provider === "codex" ? "Codex CLI is unavailable. Install it and sign in on this computer." : "Claude Code is unavailable. Install its supported runtime and configure authentication."); return; }
    try {
      setError(""); setRunning(true); setTaskResult(null); setAgentEvents([]);
      const result = await window.battleBuket.runAgent({ prompt: prompt.trim(), provider, risk });
      setTaskResult(result);
      if (result.status === "succeeded") await refreshFiles("");
    } catch (e) { setError(e instanceof Error ? e.message : "The engineering task failed to start"); }
    finally { setRunning(false); }
  };
  const cancelTask = async () => {
    try { await window.battleBuket?.cancelAgent(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not cancel the task"); }
  };

  useEffect(() => {
    window.battleBuket?.getVersion().then(setVersion).catch(() => {});
    window.battleBuket?.getAgentAvailability().then(setAvailability).catch(() => {});
    const unsubscribe = window.battleBuket?.onAgentEvent(event => {
      setAgentEvents(current => [...current, event].slice(-80));
    });
    return () => unsubscribe?.();
  }, []);

  const workspaceName = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : "Director workspace";
  const activeProviderName = provider === "codex" ? "Codex" : "Claude";

  return <main className="shell">
    <header className="top">
      <div className="brand"><span className="mark"><Braces size={17}/></span>BATTLEBUKET <b>CODES</b><small>ENGINEERING WORKSPACE</small></div>
      <div className="workspace-name"><i/> {workspaceName} <ChevronDown size={13}/></div>
      <div className="top-right">v{version}<Settings2 size={16}/></div>
    </header>
    <div className="layout">
      <nav className="rail"><LayoutDashboard/><FolderOpen/><Search/><GitBranch/><span/><ShieldCheck/></nav>
      <aside className="projects">
        <label>PROJECT EXPLORER</label>
        <button onClick={openWorkspace}><FolderOpen size={15}/> {workspace ? "Change project" : "Open project"} <Plus size={13}/></button>
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
        {!workspace && <div className="empty"><FileCode2 size={26}/><b>Your workspace starts here</b><p>Open a project folder to browse files and preview source code.</p><button className="open" onClick={openWorkspace}><Plus size={14}/> Open project</button></div>}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <footer>● Local workspace · {workspace ? "Connected" : "Ready"}</footer>
      </aside>
      <section className="center">
        <div className="tab"><FileCode2 size={14}/> {selectedFile ? selectedFile.path : "Engineering command center"}</div>
        {selectedFile ? <div className="editor-preview">
          <div className="editor-toolbar">{selectedFile.path}<span>{saveMessage || (draft !== selectedFile.content ? "Unsaved changes" : "Editable text · 1 MB limit")}</span><button onClick={saveFile} disabled={saving || draft === selectedFile.content}>{saving ? "Saving…" : "Save"}</button></div>
          <textarea className="code-editor" spellCheck={false} value={draft} onChange={event => { setDraft(event.target.value); setSaveMessage(""); }} />
        </div> : <article>
          <label className="eyebrow">AUTONOMOUS ENGINEERING WORKSPACE</label>
          <h1>Build something<br/><em>extraordinary.</em></h1>
          <p className="sub">Give the Engineering Director a task. It will run a connected provider inside your selected project workspace.</p>
          <div className="task-composer">
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe what you want to build, fix, or investigate…" disabled={running}/>
            <div className="composer-controls">
              <label>ENGINE</label>
              <select value={provider} onChange={event => setProvider(event.target.value as AgentProvider)} disabled={running}>
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
                : <button className="run-button" onClick={startTask} disabled={!workspace || !availability[provider]}><Sparkles size={15}/> Run task</button>}
            </div>
            <div className="composer-hint">{!workspace ? "Open a project folder to enable engineering tasks." : availability[provider] ? "Runtime detected · authentication is checked when the task starts; access stays restricted to the workspace." : "Selected provider runtime is not detected on this computer."}</div>
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
            <div><Workflow/><b>Quality gate</b><p>Runs a Git whitespace check. Full test, build, security, and release gates are not yet implemented.</p><small className="pending">Partial verification only</small></div>
          </div>
          <p className="prototype-note">This is an engineering preview, not a production release. A VS Code OSS workbench, integrated terminal, durable task history, full automated verification, and signed installers are still required.</p>
        </article>}
        <footer className="status"><span><GitBranch size={12}/> main</span><span><ShieldCheck size={12}/> Restricted workspace access</span><span>BattleBuket Codes · Engineering preview</span></footer>
      </section>
      <aside className="director">
        <label>● CONTROL PLANE</label><h3>Engineering Director</h3>
        <div className="director-card"><Bot/><div><b>{running ? "Supervising active task" : "Ready for a task"}</b><p>{workspace ? "Workspace: " + workspaceName : "Open a project to begin."}</p></div></div>
        <h4>PROVIDER HEALTH</h4>
        <p className="gate">◈ Codex CLI <b className={availability.codex ? "" : "pending"}>{availability.codex ? "DETECTED" : "NOT FOUND"}</b></p>
        <p className="gate">◈ Claude runtime <b className={availability.claude ? "" : "pending"}>{availability.claude ? "DETECTED" : "NOT FOUND"}</b></p>
        <h4>TASK PIPELINE</h4>
        <p className="no-tasks">{running ? "1 task running" : taskResult ? "Last task: " + taskResult.status : "No active tasks"}<br/><small>One task at a time; progress events are streamed from the provider.</small></p>
        <h4>QUALITY GATES</h4>
        <p className="gate">◈ Workspace boundary <b>ENFORCED</b></p>
        <p className="gate">◈ Git diff check <b>PARTIAL</b></p>
        <p className="gate">◈ Automated test suite <b className="pending">PENDING</b></p>
        <div className="note">✧ The app uses your local provider login. No model access or API credits are included. Review agent changes before release.</div>
      </aside>
    </div>
  </main>;
}
