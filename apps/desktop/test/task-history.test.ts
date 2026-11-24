import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTaskHistory, readTaskHistory } from "../src/main/task-history";

test("persists task state without storing prompts or model output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-task-history-"));
  try {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    await appendTaskHistory(directory, {
      taskId: "task-safe-1", provider: "codex", risk: "medium", title: "Inspect workspace security", status: "running", at: startedAt
    });
    let items = await readTaskHistory(directory);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "interrupted");
    assert.equal(items[0].title, "Inspect workspace security");

    await appendTaskHistory(directory, {
      taskId: "task-safe-1", provider: "codex", risk: "medium", title: "Inspect workspace security", status: "succeeded",
      at: new Date().toISOString(), changedFileCount: 3, verificationPassed: true
    });
    items = await readTaskHistory(directory);
    assert.equal(items[0].status, "succeeded");
    assert.equal(items[0].changedFileCount, 3);
    assert.equal(items[0].verificationPassed, true);

    const stored = await readFile(join(directory, "task-history.jsonl"), "utf8");
    assert.ok(!stored.includes("prompt"));
    assert.ok(!stored.includes("model output"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("returns an empty history for a new user data folder and ignores malformed records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-task-history-"));
  try {
    assert.deepEqual(await readTaskHistory(directory), []);
    await appendFile(join(directory, "task-history.jsonl"), "{truncated\n");
    assert.deepEqual(await readTaskHistory(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("compacts oversized history while retaining the latest task records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-task-history-"));
  try {
    const records = Array.from({ length: 2500 }, (_, index) => ({
      taskId: "task-" + index,
      provider: "codex",
      risk: "low",
      title: "Codex task",
      status: "running",
      at: new Date(index * 1000).toISOString()
    }));
    await writeFile(join(directory, "task-history.jsonl"), records.map(item => JSON.stringify(item)).join("\n") + "\n");
    await appendTaskHistory(directory, {
      taskId: "task-2499", provider: "codex", risk: "low", title: "Codex task",
      status: "succeeded", at: new Date(2_600_000).toISOString(), changedFileCount: 2, verificationPassed: true
    });
    const items = await readTaskHistory(directory);
    assert.equal(items.length, 50);
    assert.ok(items.some(item => item.taskId === "task-2499" && item.status === "succeeded"));
    const contents = await readFile(join(directory, "task-history.jsonl"), "utf8");
    assert.ok(Buffer.byteLength(contents, "utf8") < 512 * 1024);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("serializes concurrent task-history appends without dropping events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-task-history-concurrent-"));
  try {
    const events = Array.from({ length: 24 }, (_, index) => ({
      taskId: "concurrent-" + index,
      provider: index % 2 === 0 ? "codex" as const : "claude" as const,
      risk: "low" as const,
      title: "Concurrent task " + index,
      status: "succeeded" as const,
      at: new Date(index * 1000).toISOString(),
      changedFileCount: index,
      verificationPassed: true
    }));
    await Promise.all(events.map(event => appendTaskHistory(directory, event)));
    const history = await readTaskHistory(directory);
    assert.equal(history.length, events.length);
    assert.deepEqual(new Set(history.map(item => item.taskId)), new Set(events.map(item => item.taskId)));
    const stored = await readFile(join(directory, "task-history.jsonl"), "utf8");
    assert.equal(stored.trim().split(/\r?\n/).length, events.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
