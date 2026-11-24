import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const FILE_NAME = "recent-workspaces.json";
const MAX_ITEMS = 10;
const MAX_BYTES = 32 * 1024;
let writeQueue: Promise<void> = Promise.resolve();

export type RecentWorkspace = {
  path: string;
  lastOpenedAt: string;
};

function normalizePath(path: string): string {
  const resolved = path.trim();
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

function isRecentWorkspace(value: unknown): value is RecentWorkspace {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.path === "string" && item.path.length > 0 && item.path.length <= 4096 &&
    typeof item.lastOpenedAt === "string" && Number.isFinite(Date.parse(item.lastOpenedAt));
}

export async function readRecentWorkspaces(userDataPath: string): Promise<RecentWorkspace[]> {
  const file = join(userDataPath, FILE_NAME);
  let raw: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return [];
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const valid: RecentWorkspace[] = [];
  for (const candidate of parsed) {
    if (!isRecentWorkspace(candidate)) continue;
    try {
      const realPath = await fs.realpath(candidate.path);
      if (seen.has(normalizePath(realPath))) continue;
      const stat = await fs.stat(realPath);
      if (!stat.isDirectory()) continue;
      seen.add(normalizePath(realPath));
      valid.push({ path: realPath, lastOpenedAt: candidate.lastOpenedAt });
    } catch {
      // Missing or inaccessible projects are removed from the visible recent list.
    }
  }
  return valid.sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt)).slice(0, MAX_ITEMS);
}

async function recordRecentWorkspaceSerial(userDataPath: string, workspacePath: string): Promise<RecentWorkspace[]> {
  const realPath = await fs.realpath(workspacePath);
  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) throw new Error("Recent workspace must be a directory.");

  await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
  const existing = await readRecentWorkspaces(userDataPath);
  const key = normalizePath(realPath);
  const next: RecentWorkspace[] = [
    { path: realPath, lastOpenedAt: new Date().toISOString() },
    ...existing.filter(item => normalizePath(item.path) !== key)
  ].slice(0, MAX_ITEMS);

  const file = join(userDataPath, FILE_NAME);
  const temporary = join(userDataPath, "." + FILE_NAME + "." + randomUUID() + ".tmp");
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(next), "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await fs.rename(temporary, file);
    return next;
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

export function recordRecentWorkspace(userDataPath: string, workspacePath: string): Promise<RecentWorkspace[]> {
  const operation = writeQueue.then(() => recordRecentWorkspaceSerial(userDataPath, workspacePath));
  writeQueue = operation.then(() => {}, () => {});
  return operation;
}

export async function openRecentWorkspace(userDataPath: string, requestedPath: string): Promise<string> {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > 4096) {
    throw new Error("Invalid recent workspace path.");
  }
  let canonicalRequestedPath: string;
  try {
    canonicalRequestedPath = await fs.realpath(requestedPath);
  } catch {
    throw new Error("This project is not in the recent workspace list. Open it through the project picker first.");
  }
  const recent = await readRecentWorkspaces(userDataPath);
  const requestedKey = normalizePath(canonicalRequestedPath);
  const selected = recent.find(item => normalizePath(item.path) === requestedKey);
  if (!selected) throw new Error("This project is not in the recent workspace list. Open it through the project picker first.");
  return selected.path;
}
