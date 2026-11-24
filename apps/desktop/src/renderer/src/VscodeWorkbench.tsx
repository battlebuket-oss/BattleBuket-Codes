import { useEffect, useRef, useState } from "react";
import * as vscode from "vscode";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";
import getBaseServiceOverride from "@codingame/monaco-vscode-base-service-override";
import getExtensionsServiceOverride from "@codingame/monaco-vscode-extensions-service-override";
import getHostServiceOverride from "@codingame/monaco-vscode-host-service-override";
import getQuickAccessServiceOverride from "@codingame/monaco-vscode-quickaccess-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
import getMarkersServiceOverride from "@codingame/monaco-vscode-markers-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import getTerminalServiceOverride from "@codingame/monaco-vscode-terminal-service-override";
import "@codingame/monaco-vscode-all-language-feature-default-extensions";
import { configureMonacoWorkers } from "./monaco-workers";
import { BattleBuketFileSystemProvider, WORKSPACE_SCHEME } from "./vscode-workspace";

type TerminalSessionEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  text?: string;
  exitCode?: number;
};

declare global {
  interface Window {
    battleBuket?: {
      startTerminal: () => Promise<string>;
      writeTerminal: (sessionId: string, input: string) => Promise<boolean>;
      closeTerminal: (sessionId: string) => Promise<boolean>;
      resizeTerminal: (sessionId: string, columns: number, rows: number) => Promise<boolean>;
      onTerminalEvent: (listener: (event: TerminalSessionEvent) => void) => () => void;
    };
  }
}

type Runtime = {
  wrapper: MonacoVscodeApiWrapper;
  provider: BattleBuketFileSystemProvider;
  filesystemRegistration: vscode.Disposable;
  commandRegistration: vscode.Disposable;
  statusItem: vscode.StatusBarItem;
  terminal?: vscode.Terminal;
};

let runtimePromise: Promise<Runtime> | null = null;

function openNativeTerminal(runtime: Runtime): void {
  if (runtime.terminal) {
    runtime.terminal.show();
    return;
  }
  const bridge = window.battleBuket;
  if (!bridge) return;
  let sessionId: string | null = null;
  let closed = false;
  let pendingEvents: TerminalSessionEvent[] = [];
  let unsubscribe = () => {};
  let createdTerminal: vscode.Terminal | undefined;
  const output = new vscode.EventEmitter<string>();
  const close = new vscode.EventEmitter<number | void>();

  const applyEvent = (event: TerminalSessionEvent) => {
    if (!sessionId || event.sessionId !== sessionId) return;
    if (event.type === "output" && event.text) output.fire(event.text);
    else if (event.type === "error" && event.text) output.fire("\r\n\x1b[31m" + event.text + "\x1b[0m\r\n");
    else if (event.type === "exit") {
      const exitCode = event.exitCode ?? 0;
      output.fire("\r\n\x1b[90m[process exited: " + exitCode + "]\x1b[0m\r\n");
      sessionId = null;
      unsubscribe();
      close.fire(exitCode);
      if (runtime.terminal === createdTerminal) runtime.terminal = undefined;
    }
  };

  const pty: vscode.Pseudoterminal = {
    onDidWrite: output.event,
    onDidClose: close.event,
    open: async dimensions => {
      unsubscribe = bridge.onTerminalEvent(event => {
        if (!sessionId) {
          pendingEvents.push(event);
          if (pendingEvents.length > 500) pendingEvents.shift();
          return;
        }
        applyEvent(event);
      });
      try {
        const started = await bridge.startTerminal();
        sessionId = started;
        if (closed) {
          await bridge.closeTerminal(started);
          return;
        }
        for (const event of pendingEvents) applyEvent(event);
        pendingEvents = [];
        if (dimensions) await bridge.resizeTerminal(started, dimensions.columns, dimensions.rows);
      } catch (error) {
        output.fire("\r\n\x1b[31m[terminal startup failed] " + String(error) + "\x1b[0m\r\n");
        close.fire(1);
      }
    },
    close: async () => {
      closed = true;
      unsubscribe();
      pendingEvents = [];
      const active = sessionId;
      sessionId = null;
      if (active) await bridge.closeTerminal(active).catch(() => {});
      if (runtime.terminal === createdTerminal) runtime.terminal = undefined;
    },
    handleInput: data => {
      if (sessionId) void bridge.writeTerminal(sessionId, data).catch(error => {
        output.fire("\r\n\x1b[31m[input failed] " + String(error) + "\x1b[0m\r\n");
      });
    },
    setDimensions: dimensions => {
      if (sessionId) void bridge.resizeTerminal(sessionId, dimensions.columns, dimensions.rows).catch(error => {
        output.fire("\r\n\x1b[31m[resize failed] " + String(error) + "\x1b[0m\r\n");
      });
    }
  };

  createdTerminal = vscode.window.createTerminal({ name: "BattleBuket Terminal", pty });
  runtime.terminal = createdTerminal;
  createdTerminal.show();
}

async function createRuntime(container: HTMLElement): Promise<Runtime> {
  const wrapper = new MonacoVscodeApiWrapper({
    $type: "extended",
    logLevel: LogLevel.Error,
    monacoWorkerFactory: configureMonacoWorkers,
    serviceOverrides: {
      ...getBaseServiceOverride(),
      ...getHostServiceOverride(),
      ...getExtensionsServiceOverride(),
      ...getQuickAccessServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getFilesServiceOverride(),
      ...getLifecycleServiceOverride(),
      ...getExplorerServiceOverride(),
      ...getMarkersServiceOverride(),
      ...getSearchServiceOverride(),
      ...getTerminalServiceOverride()
    },
    viewsConfig: {
      $type: "WorkbenchService",
      htmlContainer: container
    },
    userConfiguration: {
      json: JSON.stringify({
        "workbench.colorTheme": "Default Dark Modern",
        "workbench.startupEditor": "none",
        "workbench.editor.enablePreview": false,
        "editor.fontSize": 13,
        "editor.minimap.enabled": true,
        "editor.fontFamily": "'DM Mono', 'Cascadia Code', monospace",
        "editor.tabSize": 2,
        "files.autoSave": "off",
        "terminal.integrated.fontFamily": "'DM Mono', monospace"
      })
    },
    workspaceConfig: {
      workspaceProvider: {
        trusted: true,
        workspace: { workspaceUri: vscode.Uri.file("/battlebuket-empty.code-workspace") },
        async open() { return true; }
      },
      configurationDefaults: {
        "workbench.colorTheme": "Default Dark Modern"
      }
    }
  });
  await wrapper.start({ caller: "BattleBuket Codes desktop workbench" });
  const provider = new BattleBuketFileSystemProvider();
  const filesystemRegistration = vscode.workspace.registerFileSystemProvider(WORKSPACE_SCHEME, provider, {
    isCaseSensitive: true,
    isReadonly: false
  });
  let runtime!: Runtime;
  const commandRegistration = vscode.commands.registerCommand("battlebuket.openNativeTerminal", () => {
    openNativeTerminal(runtime);
  });
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = "$(terminal) BattleBuket Terminal";
  statusItem.tooltip = "Open the native workspace terminal";
  statusItem.command = "battlebuket.openNativeTerminal";
  statusItem.show();
  runtime = { wrapper, provider, filesystemRegistration, commandRegistration, statusItem };
  provider.setWorkspaceRoot("");
  return runtime;
}

async function getRuntime(container: HTMLElement): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(container);
  }
  return runtimePromise;
}

export function VscodeWorkbench(props: { workspacePath: string | null; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Waiting for a project workspace…");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !props.workspacePath) {
      setStatus("Open a project folder to start the VS Code workbench.");
      return;
    }
    let cancelled = false;
    setStatus("Starting the VS Code workbench…");
    void getRuntime(container).then(async runtime => {
      if (cancelled) return;
      const uri = runtime.provider.setWorkspaceRoot(props.workspacePath!);
      const existing = vscode.workspace.workspaceFolders?.length ?? 0;
      if (!vscode.workspace.updateWorkspaceFolders(0, existing, { uri, name: props.workspacePath!.split(/[\\/]/).filter(Boolean).pop() || "Workspace" })) {
        throw new Error("VS Code could not switch to the selected workspace folder.");
      }
      setStatus("");
    }).catch(error => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus("Workbench initialization failed: " + message);
      props.onError(message);
    });
    return () => { cancelled = true; };
  }, [props.workspacePath]);

  useEffect(() => {
    const toggle = () => {
      if (!runtimePromise) return;
      void runtimePromise.then(runtime => openNativeTerminal(runtime)).catch(error => {
        props.onError(error instanceof Error ? error.message : String(error));
      });
    };
    window.addEventListener("battlebuket:toggle-terminal", toggle);
    return () => window.removeEventListener("battlebuket:toggle-terminal", toggle);
  }, [props.onError]);

  return <div className="vscode-workbench-shell">
    <div ref={containerRef} className="vscode-workbench-root" />
    {status && <div className="vscode-workbench-status" role="status">{status}</div>}
  </div>;
}
