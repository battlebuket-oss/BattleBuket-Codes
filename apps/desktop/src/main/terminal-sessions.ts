import * as pty from "node-pty";
import { promises as fs } from "node:fs";
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
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
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

  async start(
    sessionId: string,
    workspacePath: string,
    emit: (event: TerminalSessionEvent) => void,
    columns = 100,
    rows = 28
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error("Invalid terminal session identifier.");
    if (this.sessions.has(sessionId)) throw new Error("Terminal session already exists.");
    if (this.sessions.size >= 1) throw new Error("Only one workspace terminal session can be active.");
    validateTerminalSize(columns, rows);

    const cwd = await fs.realpath(workspacePath);
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
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

  async close(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    session.terminal.kill();
    await Promise.race([session.exited, delay(2500)]);
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
  }

  hasActiveSession(): boolean {
    return this.sessions.size > 0;
  }
}
