import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

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

async function copyRuntimeTree(
  sourcePath: string,
  destinationPath: string,
  sourceRoot: string,
  ancestors = new Set<string>()
): Promise<void> {
  const stat = await fs.lstat(sourcePath);
  const realSource = await fs.realpath(sourcePath);
  if (!isInside(sourceRoot, realSource)) {
    throw new Error("A Node runtime component resolves outside its installation directory: " + sourcePath);
  }

  const effectiveStat = stat.isSymbolicLink() ? await fs.stat(realSource) : stat;
  if (effectiveStat.isDirectory()) {
    if (ancestors.has(realSource)) {
      throw new Error("A cyclic directory link was found in the Node runtime: " + sourcePath);
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(realSource);
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(realSource);
    for (const entry of entries) {
      await copyRuntimeTree(
        join(realSource, entry),
        join(destinationPath, entry),
        sourceRoot,
        nextAncestors
      );
    }
    return;
  }

  if (effectiveStat.isFile()) {
    await fs.mkdir(dirname(destinationPath), { recursive: true });
    await fs.copyFile(realSource, destinationPath);
  }
}

async function findWindowsNodeExecutable(pathValue: string): Promise<string | null> {
  for (const entry of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(entry, "node.exe");
    try {
      if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

async function stageWindowsNodeRuntime(
  pathValue: string,
  containerRoot: string
): Promise<{ directory: string; executable: string; originalDirectory: string } | null> {
  const sourceExecutable = await findWindowsNodeExecutable(pathValue);
  if (!sourceExecutable) return null;

  const sourceDirectory = await fs.realpath(dirname(sourceExecutable));
  const destinationDirectory = join(containerRoot, "toolchain", "node");
  await fs.mkdir(destinationDirectory, { recursive: true });
  await copyRuntimeTree(sourceExecutable, join(destinationDirectory, "node.exe"), sourceDirectory);

  // npm and Corepack launchers resolve their JavaScript entrypoints relative to this
  // installation directory. Stage the bundled package trees beside node.exe so the
  // AppContainer never has to traverse the host drive to load a CLI entrypoint.
  for (const packageName of ["npm", "corepack"]) {
    const packageSource = join(sourceDirectory, "node_modules", packageName);
    try {
      if ((await fs.stat(packageSource)).isDirectory()) {
        await copyRuntimeTree(
          packageSource,
          join(destinationDirectory, "node_modules", packageName),
          sourceDirectory
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const launchers = await fs.readdir(sourceDirectory);
  for (const launcher of launchers.filter(name => /\.(cmd|ps1)$/i.test(name))) {
    const source = join(sourceDirectory, launcher);
    try {
      if ((await fs.stat(source)).isFile()) {
        await copyRuntimeTree(source, join(destinationDirectory, launcher), sourceDirectory);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return {
    directory: destinationDirectory,
    executable: join(destinationDirectory, "node.exe"),
    originalDirectory: sourceDirectory
  };
}

async function existingPathDirectories(): Promise<string[]> {
  const candidates = new Set<string>();
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      if (await isDirectory(entry)) {
        candidates.add(resolve(entry));
        candidates.add(await fs.realpath(entry));
      }
    } catch { /* Ignore stale PATH entries. */ }
  }
  const executablePath = await fs.realpath(process.execPath).catch(() => process.execPath);
  const executableDirectory = dirname(executablePath);
  if (await isDirectory(executableDirectory)) candidates.add(executableDirectory);
  const nodeInstallationRoot = dirname(executableDirectory);
  const globalModules = join(nodeInstallationRoot, "lib", "node_modules");
  if (await isDirectory(globalModules)) candidates.add(globalModules);
  const nodeModulesBin = join(nodeInstallationRoot, "bin");
  if (await isDirectory(nodeModulesBin)) candidates.add(nodeModulesBin);
  return [...candidates];
}

export async function prepareSandboxedCommand(
  workspacePath: string,
  executable: string,
  commandArgs: string[],
  baseEnvironment: NodeJS.ProcessEnv
): Promise<SandboxedCommand> {
  const workspace = await fs.realpath(workspacePath);
  const scratch = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "battlebuket-execution-sandbox-")));
  const scratchHome = join(scratch, "home");
  const scratchTmp = join(scratch, "tmp");
  const scratchCache = join(scratch, "cache");
  const scratchCorepack = join(scratch, "corepack");
  const scratchRoaming = join(scratchHome, "AppData", "Roaming");
  const scratchLocal = join(scratchHome, "AppData", "Local");
  let appContainerScratch: string | null = null;
  let appContainerBroker: string | null = null;
  let appContainerProfileName: string | null = null;
  let appContainerHostEnvironment: NodeJS.ProcessEnv | null = null;
  const dispose = async () => {
    if (appContainerProfileName && appContainerBroker) {
      const cleanup = spawnSync(appContainerBroker, ["--cleanup", appContainerProfileName], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: appContainerHostEnvironment ?? process.env
      });
      if (cleanup.error || cleanup.status !== 0) {
        throw new Error(
          "Windows AppContainer profile cleanup failed. " +
          (cleanup.error?.message ?? cleanup.stderr?.trim() ?? ("Broker exit code " + String(cleanup.status)))
        );
      }
      appContainerProfileName = null;
    }
    if (appContainerScratch) await fs.rm(appContainerScratch, { recursive: true, force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  };
  try {
    await Promise.all([scratchHome, scratchTmp, scratchCache, scratchCorepack, scratchRoaming, scratchLocal].map(path => fs.mkdir(path, { recursive: true })));
    const corepackCandidates = [
      process.env.COREPACK_HOME,
      baseEnvironment.LOCALAPPDATA ? join(baseEnvironment.LOCALAPPDATA, "node", "corepack") : null,
      join(homedir(), ".cache", "node", "corepack")
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    let corepackHome: string | null = null;
    for (const candidate of corepackCandidates) {
      if (await isDirectory(candidate)) {
        corepackHome = candidate;
        break;
      }
    }
    const hasCorepackHome = corepackHome !== null;
    if (corepackHome) {
      await fs.cp(corepackHome, scratchCorepack, { recursive: true, dereference: true, force: true });
    }
    const pathDirectories = await existingPathDirectories();

    if (process.platform === "win32") {
      const brokerCandidates = [
        process.env.BATTLEBUKET_APPCONTAINER_BROKER,
        join(process.cwd(), "apps", "desktop", "resources", "windows", "publish", "BattleBuket.AppContainerBroker.exe"),
        join(process.cwd(), "resources", "windows", "publish", "BattleBuket.AppContainerBroker.exe")
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
      let broker: string | null = null;
      for (const candidate of brokerCandidates) {
        try {
          await fs.access(candidate);
          broker = await fs.realpath(candidate);
          break;
        } catch { /* Try the next configured or development build location. */ }
      }
      if (!broker) {
        throw new Error("Windows project scripts are blocked because the signed-in desktop installation does not contain the Windows AppContainer broker. Rebuild the Windows app with the .NET 8 SDK; unrestricted execution is never used.");
      }
      appContainerBroker = broker;

      const hostEnvironment: NodeJS.ProcessEnv = {
        ...baseEnvironment,
        PATH: process.env.PATH ?? baseEnvironment.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
        USERPROFILE: process.env.USERPROFILE ?? baseEnvironment.USERPROFILE ?? homedir(),
        APPDATA: process.env.APPDATA ?? baseEnvironment.APPDATA,
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? baseEnvironment.LOCALAPPDATA,
        TEMP: process.env.TEMP ?? baseEnvironment.TEMP ?? tmpdir(),
        TMP: process.env.TMP ?? baseEnvironment.TMP ?? tmpdir()
      };
      appContainerHostEnvironment = hostEnvironment;
      const prepared = spawnSync(broker, ["--prepare"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: hostEnvironment
      });
      if (prepared.error || prepared.status !== 0) {
        throw new Error(
          "Windows AppContainer storage could not be prepared. " +
          (prepared.error?.message ?? prepared.stderr?.trim() ?? ("Broker exit code " + String(prepared.status)))
        );
      }
      let preparation: {
        AppContainerProfileName?: string;
        SandboxRoot?: string;
        appContainerProfileName?: string;
        sandboxRoot?: string;
      };
      try {
        preparation = JSON.parse(prepared.stdout) as typeof preparation;
      } catch {
        throw new Error("The Windows AppContainer broker returned an invalid profile preparation response.");
      }
      const profileName = preparation.AppContainerProfileName ?? preparation.appContainerProfileName ?? "";
      const containerRootText = preparation.SandboxRoot ?? preparation.sandboxRoot ?? "";
      if (!/^BattleBuketCodes_[0-9a-f]{32}$/.test(profileName) ||
          !containerRootText ||
          containerRootText.includes("\n")) {
        throw new Error("The Windows AppContainer broker returned an invalid per-run profile or temporary workspace path.");
      }
      appContainerProfileName = profileName;
      const containerRoot = await fs.realpath(containerRootText);
      appContainerScratch = containerRoot;
      const localAppData = baseEnvironment.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
      if (!localAppData) throw new Error("Windows LOCALAPPDATA is unavailable; AppContainer storage cannot be verified.");
      const packagesRoot = await fs.realpath(join(localAppData, "Packages"));
      const profileRelative = relative(packagesRoot, containerRoot);
      const profileSegments = profileRelative.split(sep).filter(Boolean);
      if (!isInside(packagesRoot, containerRoot) ||
          profileSegments.length !== 4 ||
          profileSegments[1] !== "AC" ||
          profileSegments[2] !== "Temp" ||
          !profileSegments[3].startsWith("BattleBuketCodes_")) {
        throw new Error("Windows AppContainer storage was not created under the expected per-profile Packages/<container>/AC/Temp directory.");
      }

      // The profile's own AC\\Temp directory is provisioned for this AppContainer by Windows.
      // Commands and all generated files stay below this per-run directory; the original project is never relabelled.
      const sandboxHome = join(containerRoot, "home");
      const sandboxTmp = join(containerRoot, "tmp");
      const sandboxCache = join(containerRoot, "cache");
      const sandboxCorepack = join(containerRoot, "corepack");
      const sandboxWorkspace = join(containerRoot, "workspace");
      const sandboxRoaming = join(sandboxHome, "AppData", "Roaming");
      const sandboxLocal = join(sandboxHome, "AppData", "Local");
      const stagedNode = await stageWindowsNodeRuntime(
        (baseEnvironment.PATH ?? baseEnvironment.Path ?? process.env.PATH ?? ""),
        containerRoot
      );
      await Promise.all([
        sandboxHome, sandboxTmp, sandboxCache, sandboxCorepack, sandboxWorkspace,
        sandboxRoaming, sandboxLocal
      ].map(path => fs.mkdir(path, { recursive: true })));

      let externalSymlink: string | null = null;
      await fs.cp(workspace, sandboxWorkspace, {
        recursive: true,
        dereference: true,
        filter: async source => {
          let stat;
          try { stat = await fs.lstat(source); }
          catch { return false; }
          if (!stat.isSymbolicLink()) return true;
          const target = await fs.realpath(source).catch(() => null);
          if (!target || !isInside(workspace, target)) {
            externalSymlink = source;
            return false;
          }
          return true;
        }
      });
      if (externalSymlink) {
        throw new Error("Windows AppContainer verification is blocked because the project contains a symbolic link outside the selected workspace: " + externalSymlink);
      }

      if (hasCorepackHome) {
        await fs.cp(scratchCorepack, sandboxCorepack, { recursive: true, dereference: true, force: true });
      }

      const windowsEnvironment: NodeJS.ProcessEnv = { ...baseEnvironment };
      const originalWindowsPath = baseEnvironment.PATH ?? baseEnvironment.Path ?? process.env.PATH ?? "";
      const filteredWindowsPath: string[] = [];
      for (const entry of originalWindowsPath.split(delimiter).filter(Boolean)) {
        const resolvedEntry = await fs.realpath(entry).catch(() => resolve(entry));
        if (stagedNode && resolvedEntry.toLowerCase() === stagedNode.originalDirectory.toLowerCase()) continue;
        filteredWindowsPath.push(entry);
      }
      windowsEnvironment.PATH = stagedNode
        ? [stagedNode.directory, ...filteredWindowsPath].join(delimiter)
        : originalWindowsPath;
      delete windowsEnvironment.Path;
      windowsEnvironment.HOME = sandboxHome;
      windowsEnvironment.USERPROFILE = sandboxHome;
      windowsEnvironment.APPDATA = sandboxRoaming;
      windowsEnvironment.LOCALAPPDATA = sandboxLocal;
      windowsEnvironment.TEMP = sandboxTmp;
      windowsEnvironment.TMP = sandboxTmp;
      windowsEnvironment.TMPDIR = sandboxTmp;
      windowsEnvironment.XDG_CACHE_HOME = sandboxCache;
      windowsEnvironment.COREPACK_HOME = sandboxCorepack;
      windowsEnvironment.PATHEXT = baseEnvironment.PATHEXT ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";

      const resolvedRequestedExecutable = await fs.realpath(executable).catch(() => executable);
      const discoveredNodeExecutable = await findWindowsNodeExecutable(originalWindowsPath);
      const sandboxExecutable = stagedNode && discoveredNodeExecutable &&
        resolvedRequestedExecutable.toLowerCase() === discoveredNodeExecutable.toLowerCase()
          ? stagedNode.executable
          : executable;

      const requestPath = join(scratch, "appcontainer-request.json");
      await fs.writeFile(requestPath, JSON.stringify({
        appContainerProfileName,
        workspace: sandboxWorkspace,
        scratch: containerRoot,
        executable: sandboxExecutable,
        args: commandArgs,
        environment: Object.fromEntries(
          Object.entries(windowsEnvironment).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
      }), { encoding: "utf8", mode: 0o600 });

      return {
        executable: broker,
        args: ["--request", requestPath],
        cwd: sandboxWorkspace,
        env: hostEnvironment,
        dispose
      };
    }

    if (process.platform === "linux") {
      const bwrap = await findExecutable("bwrap");
      if (!bwrap) {
        throw new Error("Linux project scripts are blocked because bubblewrap (bwrap) is not installed. Install bubblewrap to enable isolated verification.");
      }
      const help = spawnSync(bwrap, ["--help"], { encoding: "utf8", windowsHide: true });
      if (help.status !== 0 || !String(help.stdout).includes("--disable-userns")) {
        throw new Error("Linux project scripts are blocked because bubblewrap must support --disable-userns. Upgrade bubblewrap before running project commands.");
      }
      const args = [
        "--die-with-parent",
        "--new-session",
        "--unshare-user",
        "--unshare-pid",
        "--unshare-net",
        "--unshare-ipc",
        "--unshare-uts",
        "--disable-userns",
        "--cap-drop", "ALL",
        "--ro-bind", "/", "/",
        "--tmpfs", "/home",
        "--tmpfs", "/root",
        "--tmpfs", "/tmp",
        "--tmpfs", "/run",
        "--tmpfs", "/mnt",
        "--tmpfs", "/media",
        "--proc", "/proc",
        "--dev", "/dev",
        "--dir", "/tmp/battlebuket-sandbox",
        "--bind", scratch, "/tmp/battlebuket-sandbox",
        "--bind", workspace, "/tmp/battlebuket-sandbox/workspace",
        "--chdir", "/tmp/battlebuket-sandbox/workspace"
      ];
  
      const mounted = new Set<string>(["/home", "/root", "/tmp", "/run", "/mnt", "/media"]);
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
      "/Library",
      "/Applications",
      "/opt/homebrew",
      "/usr/local",
      "/private/etc",
      "/private/var/db/timezone",
      "/private/var/run",
      "/private/var/folders",
      "/var/tmp",
      "/private/var/tmp",
      "/private/tmp",
      "/dev"
    ]);
    for (const directory of pathDirectories) allowedReadPaths.add(directory);

    const quote = (value: string) => JSON.stringify(value);
    const profile = [
      "(version 1)",
      "(import \"bsd.sb\")",
      "(deny default)",
      "(allow process-exec*)",
      "(allow process-fork)",
      "(allow signal (target same-sandbox))",
      "(allow process-info* (target same-sandbox))",
      "(allow sysctl-read)",
      "(allow mach-host*)",
      "(allow mach-lookup)",
      "(allow iokit-open)",
      "(allow ipc-posix-sem)",
      "(allow ipc-posix-shm-read*)",
      "(allow file-map-executable)",
      "(allow file-read-metadata)",
      "(allow file-ioctl)",
      "(allow pseudo-tty)",
      "(allow file-read* (literal \"/dev/ptmx\"))",
      "(allow file-write* (literal \"/dev/ptmx\"))",
      "(allow file-read* (regex \"^/dev/ttys[0-9]+\"))",
      "(allow file-write* (regex \"^/dev/ttys[0-9]+\"))",
      "(allow file-write* (literal \"/dev/null\"))",
      "(allow file-write* (literal \"/dev/zero\"))",
      "(allow file-read* (literal \"/dev/random\"))",
      "(allow file-read* (literal \"/dev/urandom\"))",
      ...[...allowedReadPaths].map(path => "(allow file-read* (subpath " + quote(path) + "))"),
      "(allow file-read* (subpath (param \"WORKSPACE\")))",
      "(allow file-read* (subpath (param \"SCRATCH\")))",
      "(allow file-write* (subpath (param \"WORKSPACE\")))",
      "(allow file-write* (subpath (param \"SCRATCH\")))",
      "(deny network*)"
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
    throw new Error("No supported OS-enforced command sandbox is available on this platform.");
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}

