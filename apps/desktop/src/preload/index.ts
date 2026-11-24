import { contextBridge, ipcRenderer } from "electron";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
contextBridge.exposeInMainWorld("battleBuket", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("platform:version"),
  selectWorkspace: (): Promise<string | null> => ipcRenderer.invoke("workspace:select"),
  listWorkspace: (path = ""): Promise<WorkspaceEntry[]> => ipcRenderer.invoke("workspace:list", path),
  readWorkspaceFile: (path: string): Promise<{ path: string; content: string }> => ipcRenderer.invoke("workspace:read", path)
});
