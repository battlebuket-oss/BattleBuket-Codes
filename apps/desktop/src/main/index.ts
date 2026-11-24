import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "./workspace-files";
import { appendTaskHistory, readTaskHistory } from "./task-history";
import { WorkspaceTerminalSessions, type TerminalSessionEvent } from "./terminal-sessions";
import { runProjectQualityChecks } from "./project-verification";
import { EngineeringDirector } from "../../../../packages/engineering-director/src/index";
import { ClaudeAgentSdkAdapter, CodexCliAdapter } from "../../../../packages/provider-adapters/src/index";
import type { AgentEvent, AgentProvider, AgentTask, RiskLevel, VerificationResult } from "../../../../packages/agent-contracts/src/index";

const execFile = promisify(execFileCallback);
const adapters = [new CodexCliAdapter(), new ClaudeAgentSdkAdapter()];
const terminalSessions = new WorkspaceTerminalSessions();
let activeWorkspace: string | null = null;
let mainWindow: BrowserWindow | null = null;
let activeDirector: EngineeringDirector | null = null;
let taskStartPending = false;
let activeTerminalSessionId: string | null = null;
let shutdownInProgress = false;
let shutdownComplete = false;

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
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if ((failure.stderr ?? "").toLowerCase().includes("not a git repository")) {
      return [{ name: "Git diff whitespace check", passed: true, output: "Skipped: this workspace is not a Git working tree." }];
    }
    return [{ name: "Git diff whitespace check", passed: false, output: (failure.message ?? "Git verification failed").slice(0, 2000) }];
  }
  try {
    await execFile("git", ["diff", "--check"], {
      cwd: workspacePath, timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024
    });
    await execFile("git", ["diff", "--cached", "--check"], {
      cwd: workspacePath, timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024
    });
    return [{ name: "Git diff whitespace check", passed: true, output: "No whitespace errors in unstaged or staged changes." }];
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Git diff verification failed";
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
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; void terminalSessions.closeAll(); activeTerminalSessionId = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  if (process.argv.includes("--smoke-test")) {
    const timeout = setTimeout(() => app.exit(1), 30_000);
    const finish = (success: boolean) => {
      clearTimeout(timeout);
      app.exit(success ? 0 : 1);
    };
    window.webContents.once("did-fail-load", () => finish(false));
    window.webContents.once("did-finish-load", () => {
      void window.webContents.executeJavaScript(
        "window.battleBuket && window.battleBuket.getVersion()"
      ).then((version: unknown) => finish(typeof version === "string" && version.length > 0))
        .catch(() => finish(false));
    });
  }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}

handleTrustedIpc("platform:version", () => app.getVersion());
handleTrustedIpc("workspace:select", async () => {
  if (activeDirector || taskStartPending || terminalSessions.hasActiveSession()) throw new Error("Close the active task and terminal session before changing projects.");
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

handleTrustedIpc("terminal:start", async () => {
  if (!activeWorkspace) throw new Error("Open a project folder before starting the terminal.");
  if (activeDirector || taskStartPending) throw new Error("Close or finish the engineering task before starting the terminal.");
  if (terminalSessions.hasActiveSession()) throw new Error("A terminal session is already active.");
  const sessionId = randomUUID();
  activeTerminalSessionId = sessionId;
  try {
    await terminalSessions.start(sessionId, activeWorkspace, (event: TerminalSessionEvent) => {
      if (event.type === "exit" && activeTerminalSessionId === sessionId) activeTerminalSessionId = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("terminal:event", event);
    });
    return sessionId;
  } catch (error) {
    activeTerminalSessionId = null;
    throw error;
  }
});

handleTrustedIpc("terminal:write", async (_event, payload: { sessionId: string; input: string }) => {
  if (!payload || payload.sessionId !== activeTerminalSessionId || typeof payload.input !== "string") {
    throw new Error("Invalid or inactive terminal session.");
  }
  terminalSessions.write(payload.sessionId, payload.input);
  return true;
});

handleTrustedIpc("terminal:close", async (_event, payload: { sessionId: string }) => {
  if (!payload || payload.sessionId !== activeTerminalSessionId) return false;
  const closed = await terminalSessions.close(payload.sessionId);
  if (activeTerminalSessionId === payload.sessionId) activeTerminalSessionId = null;
  return closed;
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
  if (terminalSessions.hasActiveSession()) throw new Error("Close the integrated terminal before starting an engineering task.");

  const task: AgentTask = {
    id: randomUUID(),
    title: `${payload.provider === "codex" ? "Codex" : "Claude"} task`,
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
        detail: "The selected provider runs in its restricted read-only or workspace-write mode and applies its own sandbox rules. Sandbox and network behavior differ by provider and are not a guarantee against every host escape. Unrestricted/full-access mode is disabled. Review all changes before using or releasing them.",
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
    verify: async () => {
      const projectChecks = await runProjectQualityChecks(task.workspacePath, async (scripts, manager) => {
        const detail = [
          `Package manager: ${manager}`,
          `Commands to run: ${scripts.map(script => script === "audit" ? (manager === "pnpm" ? "pnpm audit --audit-level high" : "npm audit --audit-level=high") : `${manager} run ${script}`).join(", ")}`,
          "These repository-defined scripts can execute arbitrary code and may access the network using your user account.",
          "They run with a reduced environment, a five-minute timeout per script, and a bounded output buffer. Approve only if you trust this project."
        ].join("\n");
        const options = {
          type: "warning" as const,
          title: "Run project quality checks?",
          message: "Allow BattleBuket Codes to execute the detected test, lint, typecheck, and build scripts?",
          detail,
          buttons: ["Skip checks (task fails verification)", "Run checks"],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        };
        const answer = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
        return answer.response === 1;
      });
      const diffChecks = await verifyWorkspaceDiff(task.workspacePath);
      return [...projectChecks, ...diffChecks];
    },
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
app.on("before-quit", event => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  void terminalSessions.closeAll().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
