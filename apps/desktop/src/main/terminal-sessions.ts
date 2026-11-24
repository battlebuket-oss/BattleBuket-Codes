import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";

export const TERMINAL_MAX_INPUT_BYTES = 16 * 1024;
export const TERMINAL_MAX_SESSION_OUTPUT_BYTES = 4 * 1024 * 1024;

export type TerminalSessionEvent = {
  sessionId: string;
  type: "output" | "error" | "exit";
  stream?: "stdout" | "stderr";
  text?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

type Session = {
  child: ChildProcessWithoutNullStreams;
  bytes: number;
  emit: (event: TerminalSessionEvent) => void;
  overflowed: boolean;
};

function terminalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL"];
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

export function validateTerminalInput(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > TERMINAL_MAX_INPUT_BYTES || value.includes("\0")) {
    throw new Error("Terminal input must contain 1 to 16,384 bytes and no NUL characters.");
  }
}

export class WorkspaceTerminalSessions {
  private readonly sessions = new Map<string, Session>();

  async start(sessionId: string, workspacePath: string, emit: (event: TerminalSessionEvent) => void): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error("Invalid terminal session identifier.");
    if (this.sessions.has(sessionId)) throw new Error("Terminal session already exists.");
    if (this.sessions.size >= 1) throw new Error("Only one workspace terminal session can be active.");
    const cwd = await fs.realpath(workspacePath);
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
    const args = isWindows ? ["/D", "/Q"] : ["-i"];
    const child = spawn(shell, args, {
      cwd,
      env: terminalEnvironment(),
      stdio: "pipe",
      windowsHide: true,
      detached: !isWindows
    });
    const session: Session = { child, bytes: 0, emit, overflowed: false };
    this.sessions.set(sessionId, session);

    const forward = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
      const text = String(chunk);
      session.bytes += Buffer.byteLength(text, "utf8");
      if (session.overflowed) return;
      if (session.bytes > TERMINAL_MAX_SESSION_OUTPUT_BYTES) {
        session.overflowed = true;
        emit({ sessionId, type: "error", text: "Terminal output exceeded the 4 MB session limit; the shell was terminated." });
        void this.close(sessionId);
        return;
      }
      emit({ sessionId, type: "output", stream, text });
    };
    child.stdout.on("data", chunk => forward("stdout", chunk));
    child.stderr.on("data", chunk => forward("stderr", chunk));
    child.on("error", error => emit({ sessionId, type: "error", text: error.message.slice(0, 2000) }));
    child.on("exit", (exitCode, signal) => {
      this.sessions.delete(sessionId);
      emit({ sessionId, type: "exit", exitCode, signal });
    });
    try {
      await once(child, "spawn");
    } catch (error) {
      this.sessions.delete(sessionId);
      const detail = error instanceof Error ? error.message : "Unable to start the configured shell.";
      throw new Error("Terminal shell failed to start: " + detail.slice(0, 1000));
    }
  }

  write(sessionId: string, input: unknown): void {
    validateTerminalInput(input);
    const session = this.sessions.get(sessionId);
    if (!session || session.child.stdin.destroyed || !session.child.stdin.writable) throw new Error("Terminal session is not running.");
    session.child.stdin.write(input);
  }

  async close(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    const child = session.child;
    if (child.exitCode !== null || child.signalCode !== null) return true;
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { child.kill(); }
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
  }

  hasActiveSession(): boolean {
    return this.sessions.size > 0;
  }
}
