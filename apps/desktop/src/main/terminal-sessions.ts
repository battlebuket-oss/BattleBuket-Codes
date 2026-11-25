import * as pty from "node-pty";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;
export const TERMINAL_MAX_SESSION_OUTPUT_BYTES = 32 * 1024 * 1024;
export const TERMINAL_MAX_COLUMNS = 300;
export const TERMINAL_MAX_ROWS = 120;

export type TerminalSessionEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  text?: string;
  exitCode?: number;
  signal?: number;
};

type Session = {
  terminal: pty.IPty;
  bytes: number;
  emit: (event: TerminalSessionEvent) => void;
  overflowed: boolean;
  exited: Promise<void>;
  resolveExit: () => void;
};

function terminalEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  const allowed = [
    "PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "SHELL", "ComSpec", "SystemRoot", "WINDIR", "SystemDrive",
    "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA",
    "LANG", "LC_ALL", "USER", "LOGNAME", "USERNAME", "PATHEXT",
    "PSModulePath", "SSH_AUTH_SOCK", "JAVA_HOME", "ANDROID_HOME",
    "ANDROID_SDK_ROOT", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME",
    "PNPM_HOME", "NVM_DIR", "VOLTA_HOME"
  ];
  for (const key of allowed) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  if (process.platform !== "win32" && !env.PATH) {
    env.PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

export async function resolvePosixShell(preferredShell = process.env.SHELL): Promise<string> {
  const candidates = [...new Set([
    preferredShell,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
    "/usr/bin/bash"
  ].filter((candidate): candidate is string => typeof candidate === "string" && isAbsolute(candidate)))];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Ignore missing or non-executable configured shells and try the next system shell.
    }
  }

  throw new Error("No executable POSIX shell was found. Checked: " + candidates.join(", "));
}

export function validateTerminalInput(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > TERMINAL_MAX_INPUT_BYTES) {
    throw new Error("Terminal input must contain between 1 byte and 64 KB.");
  }
}

export function validateTerminalSize(columns: unknown, rows: unknown): asserts columns is number {
  if (!Number.isInteger(columns) || (columns as number) < 20 || (columns as number) > TERMINAL_MAX_COLUMNS ||
      !Number.isInteger(rows) || (rows as number) < 5 || (rows as number) > TERMINAL_MAX_ROWS) {
    throw new Error("Terminal size must be between 20–300 columns and 5–120 rows.");
  }
}

export class WorkspaceTerminalSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly starting = new Set<string>();
  private readonly startingDone = new Map<string, Promise<void>>();
  private readonly closing = new Map<string, Promise<boolean>>();
  private closingAll = false;
  private closeAllPromise: Promise<void> | null = null;

  async start(
    sessionId: string,
    workspacePath: string,
    emit: (event: TerminalSessionEvent) => void,
    columns = 100,
    rows = 28
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error("Invalid terminal session identifier.");
    if (this.closingAll) throw new Error("The terminal manager is shutting down and cannot start another session.");
    if (this.sessions.has(sessionId) || this.starting.has(sessionId)) throw new Error("Terminal session already exists.");
    if (this.hasActiveSession()) throw new Error("A workspace terminal session is already active, starting, or closing.");
    validateTerminalSize(columns, rows);

    // Reserve the single terminal slot before the first await so concurrent starts cannot both spawn a PTY.
    this.starting.add(sessionId);
    let resolveStart!: () => void;
    const startDone = new Promise<void>(resolve => { resolveStart = resolve; });
    this.startingDone.set(sessionId, startDone);
    try {
      const cwd = await fs.realpath(workspacePath);
      const cwdStat = await fs.stat(cwd);
      if (!cwdStat.isDirectory()) throw new Error("Workspace terminal working directory must be a directory.");
      const isWindows = process.platform === "win32";
      const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : await resolvePosixShell();
      const args = isWindows ? ["/D"] : ["-i"];
      const terminal = pty.spawn(shell, args, {
        name: "xterm-256color",
        cols: columns,
        rows,
        cwd,
        env: terminalEnvironment(),
      });

      let resolveExit!: () => void;
      const exited = new Promise<void>(resolve => { resolveExit = resolve; });
      const session: Session = { terminal, bytes: 0, emit, overflowed: false, exited, resolveExit };
      this.sessions.set(sessionId, session);

      terminal.onData(data => {
        if (session.overflowed) return;
        session.bytes += Buffer.byteLength(data, "utf8");
        if (session.bytes > TERMINAL_MAX_SESSION_OUTPUT_BYTES) {
          session.overflowed = true;
          emit({ sessionId, type: "error", text: "Terminal output exceeded the 32 MB session limit; the process was terminated." });
          void this.close(sessionId);
          return;
        }
        emit({ sessionId, type: "output", text: data });
      });

      terminal.onExit(event => {
        this.sessions.delete(sessionId);
        emit({ sessionId, type: "exit", exitCode: event.exitCode, signal: event.signal });
        session.resolveExit();
      });
    } finally {
      this.starting.delete(sessionId);
      this.startingDone.delete(sessionId);
      resolveStart();
    }
  }

  write(sessionId: string, input: unknown): void {
    validateTerminalInput(input);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Terminal session is not running.");
    session.terminal.write(input);
  }

  resize(sessionId: string, columns: unknown, rows: unknown): void {
    validateTerminalSize(columns, rows);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Terminal session is not running.");
    session.terminal.resize(columns as number, rows as number);
  }

  close(sessionId: string): Promise<boolean> {
    const pending = this.closing.get(sessionId);
    if (pending) return pending;
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve(true);

    this.sessions.delete(sessionId);
    const closing = (async () => {
      try { session.terminal.kill(); } catch { /* The shell may have exited concurrently. */ }
      const gracefulExit = await Promise.race([
        session.exited.then(() => true),
        delay(1500).then(() => false)
      ]);
      if (!gracefulExit) {
        try { session.terminal.kill("SIGKILL"); } catch { /* The process may already be gone. */ }
      }
      return Promise.race([
        session.exited.then(() => true),
        delay(1500).then(() => false)
      ]);
    })();
    this.closing.set(sessionId, closing);
    void closing.finally(() => {
      if (this.closing.get(sessionId) === closing) this.closing.delete(sessionId);
    });
    return closing;
  }

  closeAll(): Promise<void> {
    if (this.closeAllPromise) return this.closeAllPromise;
    this.closingAll = true;
    const closing = (async () => {
      // A start may be between its workspace checks and PTY creation. Wait for every
      // reserved start to settle, then close the sessions it may have created.
      await Promise.all([...this.startingDone.values()]);
      const ids = new Set([...this.sessions.keys(), ...this.closing.keys()]);
      const results = await Promise.all([...ids].map(id => this.close(id)));
      if (results.some(result => !result)) {
        throw new Error("One or more terminal processes did not confirm exit after termination.");
      }
    })();
    this.closeAllPromise = closing.then(
      () => {
        this.closingAll = false;
        this.closeAllPromise = null;
      },
      error => {
        // Fail closed: do not permit another PTY if process exit could not be confirmed.
        throw error;
      }
    );
    return this.closeAllPromise;
  }

  hasActiveSession(): boolean {
    return this.sessions.size > 0 || this.starting.size > 0 || this.closing.size > 0;
  }
}
