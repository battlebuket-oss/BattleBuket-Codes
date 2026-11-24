import { promises as fs } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isPathInside } from "./workspace-path";

export type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next", ".cache", ".turbo", ".venv", "venv", "coverage", "vendor", ".dart_tool"]);

async function resolveInside(rootPath: string, relativePath = ""): Promise<{ root: string; target: string }> {
  const root = await fs.realpath(rootPath);
  const target = await fs.realpath(resolve(root, relativePath));
  if (!isPathInside(root, target)) throw new Error("Access outside the selected workspace is blocked");
  return { root, target };
}

export async function listWorkspace(rootPath: string, relativePath = ""): Promise<WorkspaceEntry[]> {
  const { root, target } = await resolveInside(rootPath, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const fullPath = join(target, entry.name);
    const stat = await fs.stat(fullPath);
    result.push({ name: entry.name, path: relative(root, fullPath), kind: entry.isDirectory() ? "directory" : "file", size: stat.size });
  }
  return result.sort((a,b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1).slice(0,300);
}

export async function readWorkspaceFile(rootPath: string, relativePath: string) {
  const { root, target } = await resolveInside(rootPath, relativePath);
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
  const { root, target } = await resolveInside(rootPath, relativePath);
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
    const latest = await fs.stat(target);
    if (latest.dev !== original.dev || latest.ino !== original.ino || latest.size !== original.size || latest.mtimeMs !== expectedMtimeMs) {
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
        const stat = await fs.stat(real);
        result.push({ name: entry.name, path: relativePath, kind: "file", size: stat.size });
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
