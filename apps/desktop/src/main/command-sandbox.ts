import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";

export type SandboxedCommand = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  dispose: () => Promise<void>;
};

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await fs.stat(path)).isDirectory(); }
  catch { return false; }
}

async function findExecutable(name: string): Promise<string | null> {
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(entry, name);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH; absence is handled as a closed sandbox failure.
    }
  }
  return null;
}

function appendReadOnlyHomeMount(args: string[], home: string, path: string, mounted: Set<string>): void {
  const absolute = resolve(path);
  if (!isInside(home, absolute) || mounted.has(absolute)) return;
  const parents: string[] = [];
  let current = dirname(absolute);
  while (isInside(home, current) && current !== resolve(home)) {
    parents.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const parent of parents.reverse()) {
    if (!mounted.has(parent)) {
      args.push("--dir", parent);
      mounted.add(parent);
    }
  }
  args.push("--ro-bind", absolute, absolute);
  mounted.add(absolute);
}

async function existingPathDirectories(): Promise<string[]> {
  const candidates = new Set<string>();
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      if (await isDirectory(entry)) candidates.add(resolve(entry));
    } catch { /* Ignore stale PATH entries. */ }
  }
  const executableDirectory = dirname(process.execPath);
  if (await isDirectory(executableDirectory)) candidates.add(resolve(executableDirectory));
  return [...candidates];
}

export async function prepareSandboxedCommand(
  workspacePath: string,
  executable: string,
  commandArgs: string[],
  baseEnvironment: NodeJS.ProcessEnv
): Promise<SandboxedCommand> {
  const workspace = await fs.realpath(workspacePath);
  const scratch = await fs.mkdtemp(join(tmpdir(), "battlebuket-execution-sandbox-"));
  const scratchHome = join(scratch, "home");
  const scratchTmp = join(scratch, "tmp");
  const scratchCache = join(scratch, "cache");
  const scratchCorepack = join(scratch, "corepack");
  const dispose = async () => fs.rm(scratch, { recursive: true, force: true });
  try {
    await Promise.all([scratchHome, scratchTmp, scratchCache, scratchCorepack].map(path => fs.mkdir(path, { recursive: true })));
    const corepackHome = process.env.COREPACK_HOME || join(homedir(), ".cache", "node", "corepack");
    const hasCorepackHome = await isDirectory(corepackHome);
    if (hasCorepackHome) {
      await fs.cp(corepackHome, scratchCorepack, { recursive: true, dereference: false, force: true });
    }
    const pathDirectories = await existingPathDirectories();
  
    if (process.platform === "linux") {
      const bwrap = await findExecutable("bwrap");
      if (!bwrap) {
        await dispose();
        throw new Error("Linux project scripts are blocked because bubblewrap (bwrap) is not installed. Install bubblewrap to enable isolated verification.");
      }
  
      const args = [
        "--die-with-parent",
        "--new-session",
        "--unshare-user",
        "--unshare-pid",
        "--unshare-net",
        "--unshare-ipc",
        "--unshare-uts",
        "--cap-drop", "ALL",
        "--ro-bind", "/", "/",
        "--tmpfs", "/home",
        "--tmpfs", "/root",
        "--tmpfs", "/tmp",
        "--tmpfs", "/run",
        "--tmpfs", "/mnt",
        "--tmpfs", "/media",
        "--tmpfs", "/var/tmp",
        "--proc", "/proc",
        "--dev", "/dev",
        "--dir", "/workspace",
        "--bind", workspace, "/workspace",
        "--dir", "/tmp/battlebuket-sandbox",
        "--bind", scratch, "/tmp/battlebuket-sandbox",
        "--chdir", "/workspace"
      ];
  
      const mounted = new Set<string>(["/home", "/root", "/tmp", "/run", "/mnt", "/media", "/var/tmp"]);
      const home = resolve(homedir());
      for (const directory of pathDirectories) {
        if (isInside(home, directory)) appendReadOnlyHomeMount(args, home, directory, mounted);
      }
      args.push(
        "--setenv", "HOME", "/tmp/battlebuket-sandbox/home",
        "--setenv", "TMPDIR", "/tmp/battlebuket-sandbox/tmp",
        "--setenv", "TMP", "/tmp/battlebuket-sandbox/tmp",
        "--setenv", "TEMP", "/tmp/battlebuket-sandbox/tmp",
        "--setenv", "XDG_CACHE_HOME", "/tmp/battlebuket-sandbox/cache",
        "--setenv", "PATH", baseEnvironment.PATH ?? "",
        "--setenv", "LANG", baseEnvironment.LANG ?? "C.UTF-8",
        "--setenv", "LC_ALL", baseEnvironment.LC_ALL ?? "C.UTF-8",
        "--setenv", "CI", baseEnvironment.CI ?? "1"
      );
      args.push("--setenv", "COREPACK_HOME", "/tmp/battlebuket-sandbox/corepack");
      args.push("--", executable, ...commandArgs);
  
      return {
        executable: bwrap,
        args,
        cwd: workspace,
        env: {
          PATH: baseEnvironment.PATH,
          HOME: "/tmp/battlebuket-sandbox/home",
          TMPDIR: "/tmp/battlebuket-sandbox/tmp",
          TMP: "/tmp/battlebuket-sandbox/tmp",
          TEMP: "/tmp/battlebuket-sandbox/tmp",
          XDG_CACHE_HOME: "/tmp/battlebuket-sandbox/cache",
          COREPACK_HOME: "/tmp/battlebuket-sandbox/corepack",
          CI: baseEnvironment.CI ?? "1",
          LANG: baseEnvironment.LANG ?? "C.UTF-8",
          LC_ALL: baseEnvironment.LC_ALL ?? "C.UTF-8"
        },
        dispose
      };
    }
  
    if (process.platform === "darwin") {
      const sandboxExec = await findExecutable("sandbox-exec");
      if (!sandboxExec) {
        await dispose();
        throw new Error("macOS project scripts are blocked because the Seatbelt sandbox executable is unavailable.");
      }
      const allowedReadPaths = new Set([
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/Library/Apple/System/Library",
        "/Library/Developer",
        "/Applications",
        "/opt/homebrew",
        "/usr/local",
        "/dev"
      ]);
      for (const directory of pathDirectories) allowedReadPaths.add(directory);
  
      const quote = (value: string) => JSON.stringify(value);
      const profile = [
        "(version 1)",
        "(deny default)",
        "(allow process*)",
        "(allow sysctl-read)",
        "(allow mach-lookup)",
        "(allow file-read-metadata)",
        ...[...allowedReadPaths].map(path => "(allow file-read* (subpath " + quote(path) + "))"),
        "(allow file-read* (subpath (param \"WORKSPACE\")))",
        "(allow file-read* (subpath (param \"SCRATCH\")))",
        "(allow file-write* (subpath (param \"WORKSPACE\")))",
        "(allow file-write* (subpath (param \"SCRATCH\")))",
        "(deny network*)",
        "(allow signal (target self))"
      ].join("\n");
      const profilePath = join(scratch, "project-verification.sb");
      await fs.writeFile(profilePath, profile, { encoding: "utf8", mode: 0o600 });
      const corepackPath = scratchCorepack;
      const args = [
        "-f", profilePath,
        "-D", "WORKSPACE=" + workspace,
        "-D", "SCRATCH=" + scratch
      ];
      args.push(executable, ...commandArgs);
  
      return {
        executable: sandboxExec,
        args,
        cwd: workspace,
        env: {
          ...baseEnvironment,
          HOME: scratchHome,
          TMPDIR: scratchTmp,
          TMP: scratchTmp,
          TEMP: scratchTmp,
          XDG_CACHE_HOME: scratchCache,
          COREPACK_HOME: corepackPath
        },
        dispose
      };
    }
  
    await dispose();
    if (process.platform === "win32") {
      throw new Error("Windows project scripts are blocked because an OS-enforced AppContainer execution broker is not yet configured. They will not be run with unrestricted user permissions.");
    }
    throw new Error("No supported OS-enforced command sandbox is available on this platform.");
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}

