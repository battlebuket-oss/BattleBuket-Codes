import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("battleBuket", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("platform:version"),
  selectWorkspace: (): Promise<string | null> => ipcRenderer.invoke("workspace:select")
});
