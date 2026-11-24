import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../src/main/workspace-files";

test("lists folders and regular files but skips symlinks and generated directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "src", "index.ts"), "export {};");
    await writeFile(join(root, "node_modules", "ignored.js"), "");
    await symlink(join(root, "src"), join(root, "linked"));
    const entries = await listWorkspace(root);
    assert.deepEqual(entries.map(x => x.name), ["src"]);
    assert.equal((await listWorkspace(root, "src"))[0].name, "index.ts");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reads and saves files inside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-"));
  try {
    await writeFile(join(root, "a.txt"), "before");
    const opened = await readWorkspaceFile(root, "a.txt");
    const saved = await writeWorkspaceFile(root, "a.txt", "after", opened.mtimeMs);
    assert.equal(saved.path, "a.txt");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "after");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects outside paths and stale saves", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "bb-outside-"));
  try {
    await writeFile(join(root, "a.txt"), "original");
    await writeFile(join(outside, "secret.txt"), "secret");
    const opened = await readWorkspaceFile(root, "a.txt");
    await writeFile(join(root, "a.txt"), "external edit");
    await assert.rejects(() => readWorkspaceFile(root, "../" + outside.split("/").pop() + "/secret.txt"));
    await assert.rejects(() => writeWorkspaceFile(root, "a.txt", "overwrite", opened.mtimeMs), /changed outside/);
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "external edit");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
