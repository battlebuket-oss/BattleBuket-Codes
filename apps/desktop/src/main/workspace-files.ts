import { promises as fs } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isPathInside } from "./workspace-path";

export type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "out", ".next"]);

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
