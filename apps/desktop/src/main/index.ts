import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "./workspace-files";
import { appendTaskHistory, readTaskHistory } from "./task-history";
import { runWorkspaceCommand } from "./terminal";
import { EngineeringDirector } from "../../../../packages/engineering-director/src/index";
import { ClaudeAgentSdkAdapter, CodexCliAdapter } from "../../../../packages/provider-adapters/src/index";
import type { AgentEvent, AgentProvider, AgentTask, RiskLevel, VerificationResult } from "../../../../packages/agent-contracts/src/index";

const execFile = promisify(execFileCallback);
const adapters = [new CodexCliAdapter(), new ClaudeAgentSdkAdapter()];
let activeWorkspace: string | null = null;
let mainWindow: BrowserWindow | null = null;
let activeDirector: EngineeringDirector | null = null;
let taskStartPending = false;

// Only the trusted top-level renderer may invoke privileged main-process IPC.
function handleTrustedIpc(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) {
      throw new Error("IPC is only available to the trusted top-level window.");
    }
    try {
      const frameUrl = new URL(frame.url);
      const expectedRendererPath = resolve(join(__dirname, "../renderer/index.html"));
      const isPackagedRenderer = frameUrl.protocol === "file:" && resolve(fileURLToPath(frameUrl)) === expectedRendererPath;
      const devUrl = process.env.ELECTRON_RENDERER_URL;
      const configuredDevUrl = devUrl ? new URL(devUrl) : null;
      const isTrustedDevRenderer = Boolean(configuredDevUrl) &&
        frameUrl.origin === configuredDevUrl!.origin &&
        frameUrl.pathname === configuredDevUrl!.pathname;
      if (!isPackagedRenderer && !isTrustedDevRenderer) {
        throw new Error("Untrusted renderer origin.");
      }
    } catch {
      throw new Error("Untrusted renderer origin.");
    }
    return handler(event, ...args);
  });
}

async function verifyWorkspaceDiff(workspacePath: string): Promise<VerificationResult[]> {
  try {
    const git = await execFile("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspacePath, timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024
    });
    if (git.stdout.trim() !== "true") {
      return [{ name: "Git diff whitespace check", passed: true, output: "Skipped: this workspace is not a Git working tree." }];
    }
    await execFile("git", ["diff", "--check"], {
      cwd: workspacePath, timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024
    });
    return [{ name: "Git diff whitespace check", passed: true, output: "No whitespace errors reported by git diff --check." }];
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Git verification failed";
    return [{ name: "Git diff whitespace check", passed: false, output: detail.slice(0, 2000) }];
  }
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
  mainWindow = window;
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}

handleTrustedIpc("platform:version", () => app.getVersion());
handleTrustedIpc("workspace:select", async () => {
  if (activeDirector || taskStartPending) throw new Error("Finish or cancel the active engineering task before changing projects.");
  const result = await dialog.showOpenDialog({ title: "Open project folder", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  activeWorkspace = await fs.realpath(result.filePaths[0]);
  return activeWorkspace;
});
handleTrustedIpc("workspace:list", async (_event, relativePath = "") => {
  if (typeof relativePath !== "string" || relativePath.length > 4096 || !activeWorkspace) throw new Error("Invalid folder request");
  return listWorkspace(activeWorkspace, relativePath);
});
handleTrustedIpc("workspace:read", async (_event, relativePath: string) => {
  if (typeof relativePath !== "string" || relativePath.length > 4096 || !activeWorkspace) throw new Error("Invalid file request");
  return readWorkspaceFile(activeWorkspace, relativePath);
});
handleTrustedIpc("workspace:write", async (_event, payload: { path: string; content: string; expectedMtimeMs: number }) => {
  if (!payload || typeof payload.path !== "string" || payload.path.length > 4096 || !activeWorkspace) throw new Error("Invalid save request");
  return writeWorkspaceFile(activeWorkspace, payload.path, payload.content, payload.expectedMtimeMs);
});

handleTrustedIpc("tasks:history", async () => readTaskHistory(app.getPath("userData")));

handleTrustedIpc("terminal:run", async (_event, payload: { command: string }) => {
  if (!activeWorkspace) throw new Error("Open a project folder before using the terminal.");
  if (!payload || typeof payload.command !== "string") throw new Error("Invalid terminal command.");
  return runWorkspaceCommand(activeWorkspace, payload.command);
});

handleTrustedIpc("agents:availability", async () => {
  const availability = await Promise.all(adapters.map(async adapter => {
    try { return [adapter.provider, await adapter.isAvailable()] as const; }
    catch { return [adapter.provider, false] as const; }
  }));
  return Object.fromEntries(availability) as Record<AgentProvider, boolean>;
});

handleTrustedIpc("agents:run", async (_event, payload: { prompt: string; provider: AgentProvider; risk: RiskLevel }) => {
  if (!payload || typeof payload.prompt !== "string" || payload.prompt.trim().length < 3 || payload.prompt.length > 12000) {
    throw new Error("Enter a task prompt between 3 and 12,000 characters.");
  }
  if (payload.provider !== "codex" && payload.provider !== "claude") throw new Error("Unsupported provider.");
  if (payload.risk !== "low" && payload.risk !== "medium" && payload.risk !== "high") throw new Error("Invalid task risk.");
  if (!activeWorkspace) throw new Error("Open a project folder before starting an engineering task.");
  if (activeDirector || taskStartPending) throw new Error("An engineering task is already active.");

  const task: AgentTask = {
    id: randomUUID(),
    title: payload.prompt.trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 80),
    prompt: payload.prompt.trim(),
    workspacePath: activeWorkspace,
    acceptanceCriteria: [{ id: "task-result", description: "Complete the requested task and report concrete changes.", required: true }],
    risk: payload.risk,
    createdAt: new Date().toISOString()
  };
  const director = new EngineeringDirector(adapters, {
    decide: async () => ({
      primary: payload.provider,
      rationale: "Provider selected explicitly by the user in the desktop workbench.",
      requiresHumanApproval: payload.risk !== "low"
    }),
    approve: async () => {
      const options = {
        type: "warning" as const,
        title: "Approve engineering task",
        message: payload.risk === "high"
          ? "Run this task in read-only mode? The agent will not be allowed to edit files."
          : "Allow this agent to edit files and run routine local commands inside the selected project?",
        detail: "The agent is sandboxed to this workspace. Full-system access and outbound network access are disabled. Codex permission escalations use automatic review, which may consume additional provider usage. Review all changes before using or releasing them.",
        buttons: ["Cancel task", "Approve and continue"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      };
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      return result.response === 1;
    },
    verify: async () => verifyWorkspaceDiff(task.workspacePath),
    emit: (event: AgentEvent) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:event", event);
    }
  });
  const userDataPath = app.getPath("userData");
  const startedAt = new Date().toISOString();
  taskStartPending = true;
  try {
    await appendTaskHistory(userDataPath, {
      taskId: task.id, provider: payload.provider, risk: payload.risk, title: task.title, status: "running", at: startedAt
    });
    activeDirector = director;
    taskStartPending = false;
    const result = await director.execute(task);
    try {
      await appendTaskHistory(userDataPath, {
        taskId: task.id,
        provider: payload.provider,
        risk: payload.risk,
        title: task.title,
        status: result.status,
        at: new Date().toISOString(),
        changedFileCount: result.changedFiles.length,
        verificationPassed: result.verification.every(check => check.passed)
      });
    } catch {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agent:event", {
          type: "warning", taskId: task.id, timestamp: new Date().toISOString(),
          message: "Task finished, but its local history record could not be saved."
        } satisfies AgentEvent);
      }
    }
    return result;
  } catch (error) {
    try {
      await appendTaskHistory(userDataPath, {
        taskId: task.id, provider: payload.provider, risk: payload.risk, title: task.title,
        status: director.state.status === "cancelled" ? "cancelled" : "failed",
        at: new Date().toISOString()
      });
    } catch { /* Preserve the original provider or Director error. */ }
    throw error;
  } finally {
    taskStartPending = false;
    if (activeDirector === director) activeDirector = null;
  }
});

handleTrustedIpc("agents:cancel", async () => {
  if (!activeDirector) return false;
  await activeDirector.cancel();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
