import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
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
