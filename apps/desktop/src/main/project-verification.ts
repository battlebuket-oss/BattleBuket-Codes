import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { VerificationResult } from "../../../../packages/agent-contracts/src/index";

const execFile = promisify(execFileCallback);
export const QUALITY_SCRIPTS = ["test", "lint", "typecheck", "build"] as const;
export const QUALITY_TIMEOUT_MS = 5 * 60 * 1000;
export const QUALITY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type ProjectManifest = { scripts?: Record<string, unknown>; packageManager?: string };

function packageManagerFrom(manifest: ProjectManifest, files: Set<string>): PackageManager {
  const declared = manifest.packageManager?.split("@")[0];
  if (declared === "pnpm" || declared === "npm" || declared === "yarn" || declared === "bun") return declared;
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  return "npm";
}

export async function discoverQualityScripts(workspacePath: string): Promise<{ manager: PackageManager; scripts: string[] } | null> {
  const root = await fs.realpath(workspacePath);
  const manifestPath = resolve(root, "package.json");
  let raw: string;
  try {
    const stat = await fs.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Workspace package.json is not a regular file or exceeds 1 MB.");
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let manifest: ProjectManifest;
  try { manifest = JSON.parse(raw) as ProjectManifest; }
  catch { throw new Error("Workspace package.json contains invalid JSON."); }
  const entries = await fs.readdir(root);
  const manager = packageManagerFrom(manifest, new Set(entries));
  const scripts = QUALITY_SCRIPTS.filter(name => typeof manifest.scripts?.[name] === "string" && (manifest.scripts[name] as string).trim().length > 0);
  return { manager, scripts };
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "CI"];
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function runScript(manager: PackageManager, script: string, cwd: string): Promise<VerificationResult> {
  const started = Date.now();
  const executable = process.platform === "win32" ? "cmd.exe" : manager;
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `${manager} run ${script}`] : ["run", script];
  try {
    const result = await execFile(executable, args, { cwd, env: safeEnvironment(), timeout: QUALITY_TIMEOUT_MS, killSignal: "SIGTERM", maxBuffer: QUALITY_MAX_OUTPUT_BYTES, windowsHide: true, encoding: "utf8" });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-12000);
    return { name: `Project ${script}`, passed: true, output: `${manager} run ${script} passed in ${Date.now() - started} ms${output ? `\n${output}` : ""}` };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    const timedOut = failure.killed === true || failure.code === "ETIMEDOUT";
    const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n").slice(-12000);
    return { name: `Project ${script}`, passed: false, output: `${timedOut ? "Timed out" : "Failed"} after ${Date.now() - started} ms (exit ${String(failure.code ?? "unknown")})\n${output}` };
  }
}

export async function runProjectQualityChecks(
  workspacePath: string,
  approve: (scripts: string[], manager: string) => Promise<boolean>
): Promise<VerificationResult[]> {
  const project = await discoverQualityScripts(workspacePath);
  if (!project) return [{ name: "Project quality scripts", passed: true, output: "Skipped: no root package.json was found." }];
  if (project.scripts.length === 0) return [{ name: "Project quality scripts", passed: true, output: "Skipped: package.json defines none of test, lint, typecheck, or build." }];
  const approved = await approve(project.scripts, project.manager);
  if (!approved) return project.scripts.map(script => ({ name: `Project ${script}`, passed: false, output: "Not run: the user did not approve execution of repository-defined scripts." }));
  const root = await fs.realpath(workspacePath);
  const results: VerificationResult[] = [];
  for (const script of project.scripts) results.push(await runScript(project.manager, script, root));
  return results;
}