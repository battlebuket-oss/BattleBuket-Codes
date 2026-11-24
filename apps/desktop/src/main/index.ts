import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
let activeWorkspace: string | null = null;
const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next"]);

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}
async function resolveWorkspacePath(relativePath = ""): Promise<string> {
  if (!activeWorkspace) throw new Error("Open a project folder first");
  const root = await fs.realpath(activeWorkspace);
  const candidate = await fs.realpath(resolve(root, relativePath));
  if (!isInside(root, candidate)) throw new Error("Access outside the selected workspace is blocked");
  return candidate;
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: "#080b10", title: "BattleBuket Codes",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("platform:version", () => app.getVersion());
ipcMain.handle("workspace:select", async () => {
  const result = await dialog.showOpenDialog({ title: "Open project folder", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  activeWorkspace = await fs.realpath(result.filePaths[0]);
  return activeWorkspace;
});
ipcMain.handle("workspace:list", async (_event, relativePath = ""): Promise<WorkspaceEntry[]> => {
  if (typeof relativePath !== "string" || relativePath.length > 4096) throw new Error("Invalid folder path");
  const directory = await resolveWorkspacePath(relativePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const fullPath = join(directory, entry.name);
    const stat = await fs.stat(fullPath);
    result.push({
      name: entry.name,
      path: relative(activeWorkspace!, fullPath),
      kind: entry.isDirectory() ? "directory" : "file",
      size: stat.size
    });
  }
  return result.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1).slice(0, 300);
});
ipcMain.handle("workspace:read", async (_event, relativePath: string) => {
  if (typeof relativePath !== "string" || relativePath.length > 4096) throw new Error("Invalid file path");
  const file = await resolveWorkspacePath(relativePath);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("Selected path is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("File is larger than the 1 MB preview limit");
  const content = await fs.readFile(file);
  if (content.includes(0)) throw new Error("Binary files cannot be previewed as text");
  return { path: relative(activeWorkspace!, file), content: content.toString("utf8") };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
