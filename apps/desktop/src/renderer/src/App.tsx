import { useEffect, useState } from "react";
import { Activity, Bot, Braces, ChevronDown, Command, FileCode2, Folder, FolderOpen, GitBranch, LayoutDashboard, Plus, Search, Settings2, ShieldCheck, Sparkles, Workflow } from "lucide-react";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
declare global {
  interface Window {
    battleBuket?: {
      getVersion: () => Promise<string>;
      selectWorkspace: () => Promise<string | null>;
      listWorkspace: (path?: string) => Promise<WorkspaceEntry[]>;
      readWorkspaceFile: (path: string) => Promise<{ path: string; content: string }>;
    };
  }
}
export default function App() {
  const [version, setVersion] = useState("dev");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);\n  const [currentDirectory, setCurrentDirectory] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      if (selected) { setWorkspace(selected); setCurrentDirectory(""); setSelectedFile(null); await refreshFiles(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open project folder"); }
  };
  const openFile = async (path: string) => {
    try { setError(""); const file = await window.battleBuket?.readWorkspaceFile(path); if (file) setSelectedFile(file); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not read file"); }
  };
  useEffect(() => { window.battleBuket?.getVersion().then(setVersion).catch(() => {}); }, []);

  return <main className="shell">
    <header className="top"><div className="brand"><span className="mark"><Braces size={17}/></span>BATTLEBUKET <b>CODES</b><small>ENGINEERING WORKSPACE</small></div><div className="workspace-name"><i/> {workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : "Director workspace"} <ChevronDown size={13}/></div><div className="top-right">v{version}<Settings2 size={16}/></div></header>
    <div className="layout">
      <nav className="rail"><LayoutDashboard/><FolderOpen/><Search/><GitBranch/><span/><ShieldCheck/></nav>
      <aside className="projects">
        <label>PROJECT EXPLORER</label>
        <button onClick={openWorkspace}><FolderOpen size={15}/> {workspace ? "Change project" : "Open project"} <Plus size={13}/></button>
        {workspace && <div className="file-list"><div className="file-heading" onClick={() => { setCurrentDirectory(""); void refreshFiles(""); }}><Folder size={13}/> {currentDirectory || workspace.split(/[\\/]/).filter(Boolean).pop()} <span>↻</span></div>
          {loading && <small>Loading files…</small>}
          {currentDirectory && <button className="file-entry" onClick={() => { const parent = currentDirectory.split(/[\\/]/).slice(0,-1).join("/"); setCurrentDirectory(parent); void refreshFiles(parent); }}>↰ <span>..</span></button>}\n          {entries.map(entry => <button className="file-entry" key={entry.path} onClick={() => { if (entry.kind === "file") void openFile(entry.path); else { setCurrentDirectory(entry.path); void refreshFiles(entry.path); } }}>
            {entry.kind === "directory" ? <Folder size={13}/> : <FileCode2 size={13}/>}<span>{entry.name}</span>
          </button>)}
          {entries.length === 0 && !loading && <small>No visible files in this folder.</small>}
        </div>}
        {!workspace && <div className="empty"><FileCode2 size={26}/><b>Your workspace starts here</b><p>Open a project folder to browse files and preview source code.</p><button className="open" onClick={openWorkspace}><Plus size={14}/> Open project</button></div>}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <footer>● Local workspace · {workspace ? "Connected" : "Ready"}</footer>
      </aside>
      <section className="center">
        <div className="tab"><FileCode2 size={14}/> {selectedFile ? selectedFile.path : "Welcome"}</div>
        {selectedFile ? <div className="editor-preview"><div className="editor-toolbar">{selectedFile.path}<span>Read-only preview · 1 MB limit</span></div><pre>{selectedFile.content}</pre></div> :
          <article><label className="eyebrow">AUTONOMOUS ENGINEERING WORKSPACE</label><h1>Build something<br/><em>extraordinary.</em></h1><p className="sub">One command center. A team of AI engineers. Your direction.</p><div className="prompt"><Command size={16}/> Describe what you want to build... <kbd>⌘ ↵</kbd></div><div className="actions"><button onClick={openWorkspace}><FolderOpen/> Open a project</button><button disabled><GitBranch/> Clone repository · coming soon</button><button disabled><Workflow/> Engineering tasks · coming soon</button></div><div className="cards"><div><Bot/><b>Engineering Director</b><p>Planning and virtual specialist roles are implemented as a foundation.</p><small>● Control plane foundation</small></div><div><Activity/><b>Live execution</b><p>Provider runtimes are not connected yet.</p><small className="pending">Provider adapters pending</small></div><div><ShieldCheck/><b>Workspace safety</b><p>File access is limited to the selected folder, with bounded text previews.</p><small>● Scoped filesystem bridge</small></div><div><Sparkles/><b>Unified intelligence</b><p>Codex and Claude integration remains to be completed.</p><small className="pending">Integrations not connected</small></div></div></article>}
        <footer className="status"><span><GitBranch size={12}/> main</span><span><ShieldCheck size={12}/> Restricted workspace access</span><span>BattleBuket Codes · Preview</span></footer>
      </section>
      <aside className="director"><label>● CONTROL PLANE</label><h3>Engineering Director</h3><div className="director-card"><Bot/><div><b>Director standing by</b><p>Provider execution is not yet connected.</p></div></div><h4>TASK PIPELINE <span>0</span></h4><p className="no-tasks">No active tasks<br/><small>Task orchestration UI is not connected yet.</small></p><h4>QUALITY GATES</h4><p className="gate">◈ Workspace boundary <b>ENFORCED</b></p><p className="gate">◈ Automated verification <b className="pending">CI ONLY</b></p><p className="gate">◈ Isolated worktrees <b className="pending">PENDING</b></p><div className="note">✧ AI execution is disabled until provider adapters and approval controls are implemented.</div></aside>
    </div>
  </main>;
}
