import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("battleBuket",{getVersion:():Promise<string>=>ipcRenderer.invoke("platform:version")});