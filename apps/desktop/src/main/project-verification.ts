import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { VerificationResult } from "../../../../packages/agent-contracts/src/index";

const execFile = promisify(execFileCallback);
export const QUALITY_SCRIPTS = ["test", "lint", "typecheck", "build"] as const;
export const QUALITY_TIMEOUT_MS = 5 * 60 * 1000;
export const QUALITY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "go" | "cargo" | "python" | "dotnet";
type ProjectManifest = { scripts?: Record<string, unknown>; packageManager?: string };

export type QualityCommand = {
  executable: string;
  args: string[];
  display: string;
  shellCommand?: boolean;
};

export function qualityCommand(manager: PackageManager, script: string): QualityCommand {
  if (manager === "go") {
    const commands: Record<string, string[]> = {
      test: ["test", "./..."],
      lint: ["vet", "./..."],
      build: ["build", "./..."],
      security: ["./..."]
    };
    const args = commands[script];
    if (!args) throw new Error("Unsupported Go quality check: " + script);
    if (script === "security") return { executable: "govulncheck", args, display: "govulncheck ./..." };
    return { executable: "go", args, display: "go " + args.join(" ") };
  }
  if (manager === "cargo") {
    const commands: Record<string, string[]> = {
      test: ["test"],
      lint: ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"],
      typecheck: ["check", "--all-targets"],
      build: ["build", "--all-targets"],
      security: ["audit"]
    };
    const args = commands[script];
    if (!args) throw new Error("Unsupported Rust quality check: " + script);
    return { executable: "cargo", args, display: "cargo " + args.join(" ") };
  }
  if (manager === "python") {
    const commands: Record<string, string[]> = {
      test: ["-m", "pytest", "-q"],
      lint: ["-m", "ruff", "check", "."],
      typecheck: ["-m", "mypy", "."],
      build: ["-m", "build"],
      security: ["-m", "pip_audit", "-r", "requirements.txt"]
    };
    const args = commands[script];
    if (!args) throw new Error("Unsupported Python quality check: " + script);
    const executable = process.platform === "win32" ? "python" : "python3";
    return { executable, args, display: executable + " " + args.join(" ") };
  }
  if (manager === "dotnet") {
    const commands: Record<string, string[]> = {
      test: ["test"],
      lint: ["format", "--verify-no-changes"],
      build: ["build"],
      security: ["list", "package", "--vulnerable", "--include-transitive"]
    };
    const args = commands[script];
    if (!args) throw new Error("Unsupported .NET quality check: " + script);
    return { executable: "dotnet", args, display: "dotnet " + args.join(" ") };
  }

  const args = script === "audit"
    ? manager === "pnpm" ? ["audit", "--audit-level", "high"] : ["audit", "--audit-level=high"]
    : ["run", script];
  return {
    executable: manager,
    args,
    display: manager + " " + args.join(" "),
    shellCommand: true
  };
}

function packageManagerFrom(manifest: ProjectManifest, files: Set<string>): PackageManager {
  const declared = manifest.packageManager?.split("@")[0];
  if (declared === "pnpm" || declared === "npm" || declared === "yarn" || declared === "bun") return declared;
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  return "npm";
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function hasDirectory(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function discoverAlternativeProject(root: string, entries: string[]): Promise<{ manager: PackageManager; scripts: string[] } | null> {
  const entrySet = new Set(entries);
  if (entrySet.has("go.mod") && await isRegularFile(join(root, "go.mod"))) {
    return { manager: "go", scripts: ["test", "lint", "build", "security"] };
  }
  if (entrySet.has("Cargo.toml") && await isRegularFile(join(root, "Cargo.toml"))) {
    return { manager: "cargo", scripts: ["test", "lint", "typecheck", "build", "security"] };
  }
  const hasPyproject = entrySet.has("pyproject.toml") && await isRegularFile(join(root, "pyproject.toml"));
  const hasRequirements = entrySet.has("requirements.txt") && await isRegularFile(join(root, "requirements.txt"));
  if (hasPyproject || hasRequirements) {
    let config = "";
    if (hasPyproject) {
      const path = join(root, "pyproject.toml");
      const stat = await fs.stat(path);
      if (stat.size > 1024 * 1024) throw new Error("Workspace pyproject.toml exceeds the 1 MB limit.");
      config = await fs.readFile(path, "utf8");
    }
    const scripts: string[] = [];
    if (await hasDirectory(join(root, "tests")) || await hasDirectory(join(root, "test")) || config.includes("[tool.pytest.ini_options]")) scripts.push("test");
    if (config.includes("[tool.ruff]")) scripts.push("lint");
    if (config.includes("[tool.mypy]")) scripts.push("typecheck");
    if (config.includes("[build-system]")) scripts.push("build");
    if (hasRequirements) scripts.push("security");
    return { manager: "python", scripts };
  }
  const dotnetCandidates = entries.filter(name => name.endsWith(".sln") || name.endsWith(".slnx") || name.endsWith(".csproj"));
  for (const candidate of dotnetCandidates) {
    if (await isRegularFile(join(root, candidate))) {
      return { manager: "dotnet", scripts: ["test", "lint", "build", "security"] };
    }
  }
  return null;
}

export async function discoverQualityScripts(workspacePath: string): Promise<{ manager: PackageManager; scripts: string[] } | null> {
  const root = await fs.realpath(workspacePath);
  const entries = await fs.readdir(root);
  const manifestPath = resolve(root, "package.json");

  if (await isRegularFile(manifestPath)) {
    const stat = await fs.stat(manifestPath);
    if (stat.size > 1024 * 1024) throw new Error("Workspace package.json exceeds the 1 MB limit.");
    const raw = await fs.readFile(manifestPath, "utf8");
    let manifest: ProjectManifest;
    try { manifest = JSON.parse(raw) as ProjectManifest; }
    catch { throw new Error("Workspace package.json contains invalid JSON."); }
    const manager = packageManagerFrom(manifest, new Set(entries));
    const scripts: string[] = QUALITY_SCRIPTS.filter(name =>
      typeof manifest.scripts?.[name] === "string" && (manifest.scripts[name] as string).trim().length > 0
    );
    const hasSupportedAuditLock = (manager === "pnpm" && entries.includes("pnpm-lock.yaml")) ||
      (manager === "npm" && entries.includes("package-lock.json"));
    if (hasSupportedAuditLock) scripts.push("audit");
    if (scripts.length > 0) return { manager, scripts };
  }

  return discoverAlternativeProject(root, entries);
}

export function hasExecutableQualityChecks(scripts: string[]): boolean {
  return scripts.some(script => script !== "audit" && script !== "security");
}

export function formatQualityCommand(manager: string, script: string): string {
  return qualityCommand(manager as PackageManager, script).display;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "CI"];
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

export function dotnetOutputHasVulnerabilities(output: string): boolean {
  if (/no vulnerable packages found|no vulnerable packages/i.test(output)) return false;
  return /has the following vulnerable packages|vulnerable package(?:s)? found|vulnerabilities found/i.test(output);
}

async function runScript(manager: PackageManager, script: string, cwd: string, signal?: AbortSignal): Promise<VerificationResult> {
  const started = Date.now();
  const spec = qualityCommand(manager, script);
  const label = script === "audit" || script === "security" ? "Project dependency/security audit" : "Project " + script;
  const executable = process.platform === "win32" && spec.shellCommand ? "cmd.exe" : spec.executable;
  const args = process.platform === "win32" && spec.shellCommand
    ? ["/d", "/s", "/c", spec.display]
    : spec.args;
  try {
    const result = await execFile(executable, args, {
      cwd,
      env: safeEnvironment(),
      timeout: QUALITY_TIMEOUT_MS,
      killSignal: "SIGTERM",
      maxBuffer: QUALITY_MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: "utf8",
      ...(signal ? { signal } : {})
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-12000);
    if (manager === "dotnet" && script === "security" && dotnetOutputHasVulnerabilities(output)) {
      return { name: label, passed: false, output: "Vulnerable packages were reported by dotnet.\n" + output };
    }
    return { name: label, passed: true, output: spec.display + " passed in " + (Date.now() - started) + " ms" + (output ? "\n" + output : "") };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    const timedOut = failure.killed === true || failure.code === "ETIMEDOUT";
    if (signal?.aborted) return { name: label, passed: false, output: "Cancelled by the user." };
    const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n").slice(-12000);
    return { name: label, passed: false, output: (timedOut ? "Timed out" : "Failed") + " after " + (Date.now() - started) + " ms (exit " + String(failure.code ?? "unknown") + ")\n" + output };
  }
}

export async function runProjectQualityChecks(
  workspacePath: string,
  approve: (scripts: string[], manager: string) => Promise<boolean>,
  signal?: AbortSignal
): Promise<VerificationResult[]> {
  if (signal?.aborted) return [{ name: "Project quality checks", passed: false, output: "Cancelled by the user." }];
  const project = await discoverQualityScripts(workspacePath);
  if (!project) return [{
    name: "Project quality capability",
    passed: false,
    output: "Not verified: no supported root project manifest or test/build scripts were detected. The Git whitespace check alone is not a substitute for project tests, lint, typecheck or build."
  }];
  if (project.scripts.length === 0) return [{
    name: "Project quality capability",
    passed: false,
    output: "Not verified: the detected " + project.manager + " project does not expose supported test, lint, typecheck or build checks. Configure its toolchain before treating changes as verified."
  }];
  const approved = await approve(project.scripts, project.manager);
  if (signal?.aborted) return [{ name: "Project quality checks", passed: false, output: "Cancelled by the user." }];
  if (!approved) return project.scripts.map(script => ({
    name: script === "audit" || script === "security" ? "Project dependency/security audit" : "Project " + script,
    passed: false,
    output: "Not run: the user did not approve execution of repository-defined quality commands."
  }));
  const root = await fs.realpath(workspacePath);
  const results: VerificationResult[] = [];
  if (!hasExecutableQualityChecks(project.scripts)) {
    results.push({
      name: "Project quality capability",
      passed: false,
      output: "Dependency scanning is available, but no test, lint, typecheck or build check is configured. Security scanning alone cannot certify an implementation change."
    });
  }
  for (const script of project.scripts) {
    if (signal?.aborted) break;
    results.push(await runScript(project.manager, script, root, signal));
  }
  if (signal?.aborted && results.length === 0) {
    results.push({ name: "Project quality checks", passed: false, output: "Cancelled by the user." });
  }
  return results;
}
