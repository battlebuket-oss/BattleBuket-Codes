import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";

const execFile = promisify(execFileCallback);
export const TERMINAL_MAX_COMMAND_LENGTH = 4000;
export const TERMINAL_MAX_RUNTIME_MS = 120_000;
export const TERMINAL_MAX_OUTPUT_BYTES = 1024 * 1024;

export function validateTerminalCommand(command: unknown): asserts command is string {
  if (typeof command !== "string" || command.trim().length === 0 || command.length > TERMINAL_MAX_COMMAND_LENGTH) {
    throw new Error("Enter a terminal command between 1 and 4,000 characters.");
  }
}

export type TerminalCommandResult = { command: string; exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean };

export async function runWorkspaceCommand(workspacePath: string, command: string, platform = process.platform): Promise<TerminalCommandResult> {
  validateTerminalCommand(command);
  const cwd = await fs.realpath(workspacePath);
  const started = Date.now();
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TERM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const executable = platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  try {
    const result = await execFile(executable, args, { cwd, env, timeout: TERMINAL_MAX_RUNTIME_MS, killSignal: "SIGTERM", maxBuffer: TERMINAL_MAX_OUTPUT_BYTES, windowsHide: true, encoding: "utf8" });
    return { command, exitCode: 0, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - started, timedOut: false };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    const timedOut = failure.killed === true || failure.code === "ETIMEDOUT";
    return { command, exitCode: typeof failure.code === "number" ? failure.code : timedOut ? 124 : 1, stdout: typeof failure.stdout === "string" ? failure.stdout : "", stderr: typeof failure.stderr === "string" ? failure.stderr : failure.message.slice(0, 4000), durationMs: Date.now() - started, timedOut };
  }
}