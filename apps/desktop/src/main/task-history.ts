import { promises as fs } from "node:fs";
import { join } from "node:path";

export type TaskHistoryStatus = "running" | "succeeded" | "failed" | "cancelled";
export type TaskHistoryEvent = {
  taskId: string;
  provider: "codex" | "claude";
  risk: "low" | "medium" | "high";
  status: TaskHistoryStatus;
  at: string;
  changedFileCount?: number;
  verificationPassed?: boolean;
};
export type TaskHistoryItem = Omit<TaskHistoryEvent, "at" | "status"> & {
  startedAt: string;
  finishedAt?: string;
  status: TaskHistoryStatus | "interrupted";
};

const FILE_NAME = "task-history.jsonl";
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ITEMS = 50;

function isHistoryEvent(value: unknown): value is TaskHistoryEvent {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.taskId === "string" && item.taskId.length > 0 && item.taskId.length <= 128 &&
    (item.provider === "codex" || item.provider === "claude") &&
    (item.risk === "low" || item.risk === "medium" || item.risk === "high") &&
    (item.status === "running" || item.status === "succeeded" || item.status === "failed" || item.status === "cancelled") &&
    typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) &&
    (item.changedFileCount === undefined || (typeof item.changedFileCount === "number" && Number.isSafeInteger(item.changedFileCount) && item.changedFileCount >= 0)) &&
    (item.verificationPassed === undefined || typeof item.verificationPassed === "boolean");
}

export async function appendTaskHistory(userDataPath: string, event: TaskHistoryEvent): Promise<void> {
  if (!isHistoryEvent(event)) throw new Error("Invalid task history event");
  await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
  const directory = await fs.realpath(userDataPath);
  const file = join(directory, FILE_NAME);
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) await fs.truncate(file, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const safeEvent: TaskHistoryEvent = {
    taskId: event.taskId,
    provider: event.provider,
    risk: event.risk,
    status: event.status,
    at: event.at,
    ...(event.changedFileCount === undefined ? {} : { changedFileCount: event.changedFileCount }),
    ...(event.verificationPassed === undefined ? {} : { verificationPassed: event.verificationPassed })
  };
  await fs.appendFile(file, JSON.stringify(safeEvent) + "\n", { encoding: "utf8", mode: 0o600, flag: "a" });
}

export async function readTaskHistory(userDataPath: string, now = new Date()): Promise<TaskHistoryItem[]> {
  const file = join(userDataPath, FILE_NAME);
  let contents: string;
  try {
    const stat = await fs.stat(file);
    const handle = await fs.open(file, "r");
    try {
      const start = Math.max(0, stat.size - MAX_FILE_BYTES);
      const buffer = Buffer.alloc(stat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      contents = buffer.toString("utf8");
      if (start > 0) contents = contents.slice(contents.indexOf("\n") + 1);
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const tasks = new Map<string, TaskHistoryItem>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isHistoryEvent(parsed)) continue;
      const current = tasks.get(parsed.taskId);
      if (!current) {
        tasks.set(parsed.taskId, {
          taskId: parsed.taskId,
          provider: parsed.provider,
          risk: parsed.risk,
          status: parsed.status,
          startedAt: parsed.at,
          ...(parsed.status === "running" ? {} : { finishedAt: parsed.at }),
          ...(parsed.changedFileCount === undefined ? {} : { changedFileCount: parsed.changedFileCount }),
          ...(parsed.verificationPassed === undefined ? {} : { verificationPassed: parsed.verificationPassed })
        });
      } else {
        current.status = parsed.status;
        if (parsed.status !== "running") current.finishedAt = parsed.at;
        if (parsed.changedFileCount !== undefined) current.changedFileCount = parsed.changedFileCount;
        if (parsed.verificationPassed !== undefined) current.verificationPassed = parsed.verificationPassed;
      }
    } catch { /* Ignore an incomplete or malformed trailing record. */ }
  }
  return [...tasks.values()]
    .map(item => item.status === "running"
      ? { ...item, status: "interrupted" as const }
      : item)
    .sort((a,b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_ITEMS);
}
