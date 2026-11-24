import { promises as fs } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isPathInside } from "./workspace-path";

export type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number; mtimeMs: number };
const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_WORKBENCH_FILE_BYTES = 64 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next", ".cache", ".turbo", ".venv", "venv", "coverage", "vendor", ".dart_tool"]);

async function resolveInside(rootPath: string, relativePath = ""): Promise<{ root: string; target: string }> {
  const root = await fs.realpath(rootPath);
  const target = await fs.realpath(resolve(root, relativePath));
  if (!isPathInside(root, target)) throw new Error("Access outside the selected workspace is blocked");
  return { root, target };
}

async function resolveWorkspacePath(rootPath: string, relativePath = "", allowMissingFinal = false): Promise<{ root: string; target: string }> {
  if (typeof relativePath !== "string" || relativePath.includes("\0") || relativePath.length > 4096) {
    throw new Error("Invalid workspace-relative path.");
  }
  const root = await fs.realpath(rootPath);
  const target = resolve(root, relativePath);
  if (!isPathInside(root, target)) throw new Error("Access outside the selected workspace is blocked");
  const relativeTarget = relative(root, target);
  if (!relativeTarget || relativeTarget === ".") return { root, target: root };
  const segments = relativeTarget.split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error("Access outside the selected workspace is blocked (symbolic links are not followed)");
      }
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new Error("A workspace path parent is not a directory.");
      }
    } catch (error) {
      if (allowMissingFinal && index === segments.length - 1 &&
          (error as NodeJS.ErrnoException).code === "ENOENT") return { root, target: current };
      throw error;
    }
  }
  return { root, target };
}

export async function listWorkspace(rootPath: string, relativePath = ""): Promise<WorkspaceEntry[]> {
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const fullPath = join(target, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) continue;
    result.push({ name: entry.name, path: relative(root, fullPath), kind: entry.isDirectory() ? "directory" : "file", size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return result.sort((a,b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1).slice(0,300);
}

export async function readWorkspaceFile(rootPath: string, relativePath: string) {
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Selected path is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("File is larger than the 1 MB preview limit");
  const content = await fs.readFile(target);
  if (content.includes(0)) throw new Error("Binary files cannot be previewed as text");
  return { path: relative(root, target), content: content.toString("utf8"), mtimeMs: stat.mtimeMs };
}

export async function writeWorkspaceFile(rootPath: string, relativePath: string, content: string, expectedMtimeMs: number) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("File exceeds the 1 MB save limit");
  if (!Number.isFinite(expectedMtimeMs)) throw new Error("Invalid file version");
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath);
  const original = await fs.stat(target);
  if (!original.isFile()) throw new Error("Selected path is not a regular file");
  if (original.mtimeMs !== expectedMtimeMs) throw new Error("File changed outside BattleBuket Codes. Reopen it before saving to avoid overwriting newer changes.");

  const parent = dirname(target);
  const temporary = join(parent, "." + basename(target) + "." + randomUUID() + ".tmp");
  const temporaryHandle = await fs.open(temporary, "wx", original.mode & 0o777);
  try {
    await temporaryHandle.writeFile(content, "utf8");
    await temporaryHandle.sync();
  } catch (error) {
    await temporaryHandle.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  await temporaryHandle.close();

  try {
    const latest = await fs.lstat(target);
    if (latest.isSymbolicLink() || latest.dev !== original.dev || latest.ino !== original.ino || latest.size !== original.size || latest.mtimeMs !== expectedMtimeMs) {
      throw new Error("File changed while the save was being prepared. Reopen it before trying again.");
    }
    await fs.rename(temporary, target);
    let directoryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      directoryHandle = await fs.open(parent, "r");
      await directoryHandle.sync();
    } catch {
      // Directory fsync is not supported on every platform; the file itself was synced before rename.
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
    return { path: relative(root, target), mtimeMs: (await fs.stat(target)).mtimeMs };
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}


export async function createWorkspaceDirectory(rootPath: string, relativePath: string): Promise<void> {
  const { target } = await resolveWorkspacePath(rootPath, relativePath, true);
  if (target === await fs.realpath(rootPath)) throw new Error("The workspace root already exists.");
  await fs.mkdir(target);
}

export async function createWorkspaceFile(rootPath: string, relativePath: string, content: string | Uint8Array): Promise<{ path: string; mtimeMs: number }> {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (bytes.byteLength > MAX_WORKBENCH_FILE_BYTES) throw new Error("File exceeds the 64 MB workspace write limit.");
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath, true);
  if (target === root) throw new Error("Cannot create a file over the workspace root.");
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(target).catch(() => {});
    throw error;
  }
  await handle.close();
  return { path: relative(root, target), mtimeMs: (await fs.stat(target)).mtimeMs };
}

export async function readWorkspaceFileSystemFile(rootPath: string, relativePath: string): Promise<{ path: string; content: Uint8Array; mtimeMs: number; size: number }> {
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Selected path is not a regular workspace file.");
  if (stat.size > MAX_WORKBENCH_FILE_BYTES) throw new Error("File exceeds the 64 MB workspace read limit.");
  const content = await fs.readFile(target);
  return { path: relative(root, target), content: Uint8Array.from(content), mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function writeWorkspaceFileSystemFile(
  rootPath: string,
  relativePath: string,
  content: Uint8Array,
  create: boolean,
  overwrite: boolean
): Promise<{ path: string; mtimeMs: number }> {
  if (!(content instanceof Uint8Array) || typeof create !== "boolean" || typeof overwrite !== "boolean") {
    throw new Error("Invalid workspace file write options.");
  }
  if (content.byteLength > MAX_WORKBENCH_FILE_BYTES) throw new Error("File exceeds the 64 MB workspace write limit.");
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath, true);
  if (target === root) throw new Error("The workspace root cannot be replaced.");
  let original: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try { original = await fs.lstat(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (original) {
    if (original.isSymbolicLink() || !original.isFile()) throw new Error("Selected path is not a regular workspace file.");
    if (!overwrite) throw new Error("File already exists.");
  } else if (!create) {
    const error = new Error("File does not exist.") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }

  const parent = dirname(target);
  const temporary = join(parent, "." + basename(target) + "." + randomUUID() + ".tmp");
  const handle = await fs.open(temporary, "wx", original ? original.mode & 0o777 : 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();

  try {
    if (original) {
      const latest = await fs.lstat(target);
      if (latest.isSymbolicLink() || !latest.isFile() || latest.dev !== original.dev ||
          latest.ino !== original.ino || latest.size !== original.size || latest.mtimeMs !== original.mtimeMs) {
        throw new Error("File changed while the save was being prepared. Reopen it before trying again.");
      }
    } else {
      try {
        await fs.lstat(target);
        throw new Error("File was created by another process while the save was being prepared.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await fs.rename(temporary, target);
    let directoryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      directoryHandle = await fs.open(parent, "r");
      await directoryHandle.sync();
    } catch { /* Directory fsync is not available on every platform. */ }
    finally { await directoryHandle?.close().catch(() => {}); }
    const result = await fs.stat(target);
    return { path: relative(root, target), mtimeMs: result.mtimeMs };
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function deleteWorkspacePath(rootPath: string, relativePath: string, recursive: boolean): Promise<void> {
  const { root, target } = await resolveWorkspacePath(rootPath, relativePath);
  if (target === root) throw new Error("The workspace root cannot be deleted.");
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be deleted through the workspace provider.");
  if (stat.isDirectory() && !recursive) {
    await fs.rmdir(target);
    return;
  }
  await fs.rm(target, { recursive, force: false });
}

export async function renameWorkspacePath(
  rootPath: string,
  oldRelativePath: string,
  newRelativePath: string,
  overwrite: boolean
): Promise<void> {
  const { root, target: source } = await resolveWorkspacePath(rootPath, oldRelativePath);
  const { target: destination } = await resolveWorkspacePath(rootPath, newRelativePath, true);
  if (source === root || destination === root) throw new Error("The workspace root cannot be renamed or replaced.");
  if (isPathInside(source, destination)) throw new Error("A directory cannot be moved inside itself.");
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error("Symbolic links cannot be renamed through the workspace provider.");
  try {
    const destinationStat = await fs.lstat(destination);
    if (destinationStat.isSymbolicLink()) throw new Error("Symbolic links cannot be replaced through the workspace provider.");
    if (!overwrite) throw new Error("Destination already exists.");
    await fs.rm(destination, { recursive: destinationStat.isDirectory(), force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.rename(source, destination);
}


export async function searchWorkspaceFiles(rootPath: string, query: string): Promise<WorkspaceEntry[]> {
  if (typeof query !== "string" || query.trim().length < 1 || query.length > 200) return [];
  const { root, target } = await resolveInside(rootPath, "");
  const needle = query.trim().toLocaleLowerCase();
  const result: WorkspaceEntry[] = [];
  let scanned = 0;
  const maxScanned = 20_000;
  const maxResults = 200;
  const maxDepth = 12;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || scanned >= maxScanned || result.length >= maxResults) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (scanned >= maxScanned || result.length >= maxResults) break;
      scanned++;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        try {
          const real = await fs.realpath(fullPath);
          if (!isPathInside(root, real)) continue;
          await walk(real, depth + 1);
        } catch { /* Ignore directories removed or made inaccessible during search. */ }
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = relative(root, fullPath);
      if (!relativePath.toLocaleLowerCase().includes(needle)) continue;
      try {
        const real = await fs.realpath(fullPath);
        if (!isPathInside(root, real)) continue;
        const stat = await fs.lstat(real);
        if (stat.isSymbolicLink() || !stat.isFile()) continue;
        result.push({ name: entry.name, path: relativePath, kind: "file", size: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* Ignore files removed or made inaccessible during search. */ }
    }
  };

  await walk(target, 0);
  return result.sort((a, b) => {
    const aPath = a.path.toLocaleLowerCase();
    const bPath = b.path.toLocaleLowerCase();
    const aName = a.name.toLocaleLowerCase();
    const bName = b.name.toLocaleLowerCase();
    const score = (path: string, name: string) => name === needle ? 0 : name.startsWith(needle) ? 1 : path.startsWith(needle) ? 2 : 3;
    return score(aPath, aName) - score(bPath, bName) || a.path.localeCompare(b.path);
  }).slice(0, maxResults);
}


export type WorkspaceContentMatch = {
  path: string;
  lineNumber: number;
  preview: string;
};

export async function searchWorkspaceContent(rootPath: string, query: string): Promise<WorkspaceContentMatch[]> {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 200) return [];
  const { root, target } = await resolveInside(rootPath, "");
  const needle = query.trim().toLocaleLowerCase();
  const matches: WorkspaceContentMatch[] = [];
  let scannedFiles = 0;
  let scannedEntries = 0;
  let bytesRead = 0;
  const maxScannedFiles = 3000;
  const maxScannedEntries = 20_000;
  const maxTotalBytes = 64 * 1024 * 1024;
  const maxMatches = 200;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12 || scannedFiles >= maxScannedFiles || scannedEntries >= maxScannedEntries || bytesRead >= maxTotalBytes || matches.length >= maxMatches) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (scannedFiles >= maxScannedFiles || scannedEntries >= maxScannedEntries || bytesRead >= maxTotalBytes || matches.length >= maxMatches) break;
      scannedEntries++;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        try {
          const real = await fs.realpath(fullPath);
          if (isPathInside(root, real)) await walk(real, depth + 1);
        } catch { /* Ignore directories removed or made inaccessible during search. */ }
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles++;
      try {
        const real = await fs.realpath(fullPath);
        if (!isPathInside(root, real)) continue;
        const stat = await fs.stat(real);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES || bytesRead + stat.size > maxTotalBytes) continue;
        const content = await fs.readFile(real);
        bytesRead += content.byteLength;
        if (content.includes(0)) continue;
        const text = content.toString("utf8");
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index];
          if (!line.toLocaleLowerCase().includes(needle)) continue;
          matches.push({
            path: relative(root, real),
            lineNumber: index + 1,
            preview: line.trim().slice(0, 280)
          });
          if (matches.length >= maxMatches) break;
        }
      } catch { /* Ignore files changed or removed during search. */ }
    }
  };

  await walk(target, 0);
  return matches.sort((a, b) =>
    a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber
  );
}
