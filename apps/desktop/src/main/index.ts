import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "./workspace-files";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
let activeWorkspace: string | null = null;
const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next"]);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: "#080b10", title: "BattleBuket Codes",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
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
ipcMain.handle("workspace:list", async (_event, relativePath = "") => {
  if (typeof relativePath !== "string" || relativePath.length > 4096 || !activeWorkspace) throw new Error("Invalid folder request");
  return listWorkspace(activeWorkspace, relativePath);
});
ipcMain.handle("workspace:read", async (_event, relativePath: string) => {
  if (typeof relativePath !== "string" || relativePath.length > 4096 || !activeWorkspace) throw new Error("Invalid file request");
  return readWorkspaceFile(activeWorkspace, relativePath);
});
ipcMain.handle("workspace:write", async (_event, payload: { path: string; content: string; expectedMtimeMs: number }) => {
  if (!payload || typeof payload.path !== "string" || payload.path.length > 4096 || !activeWorkspace) throw new Error("Invalid save request");
  return writeWorkspaceFile(activeWorkspace, payload.path, payload.content, payload.expectedMtimeMs);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
