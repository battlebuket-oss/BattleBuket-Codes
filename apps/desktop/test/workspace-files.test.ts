import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceDirectory, createWorkspaceFile, deleteWorkspacePath, listWorkspace, readWorkspaceFile, readWorkspaceFileSystemFile, renameWorkspacePath, searchWorkspaceContent, searchWorkspaceFiles, writeWorkspaceFile, writeWorkspaceFileSystemFile } from "../src/main/workspace-files";

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
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
    await assert.rejects(() => readWorkspaceFile(root, "leak.txt"), /outside the selected workspace/);
    await assert.rejects(() => writeWorkspaceFile(root, "leak.txt", "tamper", 0), /outside the selected workspace/);
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

test("rejects binary and oversized previews without altering the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-"));
  try {
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await assert.rejects(() => readWorkspaceFile(root, "binary.bin"), /Binary files/);
    await assert.rejects(() => readWorkspaceFile(root, "large.txt"), /1 MB preview limit/);
    await assert.rejects(() => writeWorkspaceFile(root, "large.txt", "y".repeat(1024 * 1024 + 1), 0), /1 MB save limit/);
    assert.equal((await readFile(join(root, "large.txt"), "utf8")).length, 1024 * 1024 + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("quick-open search finds nested files and excludes generated folders and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-search-"));
  try {
    await mkdir(join(root, "src", "components"), { recursive: true });
    await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, "src", "components", "SearchPanel.tsx"), "export {};");
    await writeFile(join(root, "node_modules", "fixture", "SearchPanel.tsx"), "ignored");
    await writeFile(join(root, ".git", "objects", "SearchPanel.tsx"), "ignored");
    await symlink(join(root, "src"), join(root, "linked-src"));
    const matches = await searchWorkspaceFiles(root, "searchpanel");
    assert.deepEqual(matches.map(item => item.path), ["src/components/SearchPanel.tsx"]);
    assert.deepEqual(await searchWorkspaceFiles(root, ""), []);
    assert.deepEqual(await searchWorkspaceFiles(root, "x".repeat(201)), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project content search returns line previews and ignores generated, binary, symlink and oversized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-content-search-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
    await writeFile(join(root, "src", "feature.ts"), [
      "export const first = 1;",
      "const marker = 'BATTLEBUKET_CONTENT_MATCH';",
      "export { marker };"
    ].join("\n"));
    await writeFile(join(root, "node_modules", "fixture", "ignored.ts"), "BATTLEBUKET_CONTENT_MATCH");
    await writeFile(join(root, "src", "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, "src", "oversized.txt"), "BATTLEBUKET_CONTENT_MATCH" + "x".repeat(1024 * 1024));
    await symlink(join(root, "src", "feature.ts"), join(root, "linked-feature.ts"));

    const matches = await searchWorkspaceContent(root, "BATTLEBUKET_CONTENT_MATCH");
    assert.deepEqual(matches, [{
      path: "src/feature.ts",
      lineNumber: 2,
      preview: "const marker = 'BATTLEBUKET_CONTENT_MATCH';"
    }]);
    assert.deepEqual(await searchWorkspaceContent(root, "x"), []);
    assert.deepEqual(await searchWorkspaceContent(root, "x".repeat(201)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace filesystem provider operations create, write, rename and delete safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-provider-"));
  try {
    await createWorkspaceDirectory(root, "src");
    const created = await createWorkspaceFile(root, "src/app.ts", new TextEncoder().encode("export const value = 1;"));
    assert.equal(created.path, "src/app.ts");
    const opened = await readWorkspaceFile(root, "src/app.ts");
    assert.equal(opened.content, "export const value = 1;");
    assert.equal(typeof opened.mtimeMs, "number");

    const overwritten = await writeWorkspaceFileSystemFile(root, "src/app.ts", new TextEncoder().encode("export const value = 2;"), false, true);
    assert.equal(overwritten.path, "src/app.ts");
    assert.equal((await readWorkspaceFile(root, "src/app.ts")).content, "export const value = 2;");
    await assert.rejects(
      () => writeWorkspaceFileSystemFile(root, "src/app.ts", new TextEncoder().encode("no overwrite"), true, false),
      /File already exists/
    );

    await createWorkspaceDirectory(root, "src/nested");
    await createWorkspaceFile(root, "src/nested/new.ts", new TextEncoder().encode("export {};"));
    await renameWorkspacePath(root, "src/nested/new.ts", "src/nested/renamed.ts", false);
    assert.equal((await readWorkspaceFile(root, "src/nested/renamed.ts")).content, "export {};");
    await deleteWorkspacePath(root, "src/nested/renamed.ts", false);
    await deleteWorkspacePath(root, "src/nested", false);
    await assert.rejects(() => readWorkspaceFile(root, "src/nested/renamed.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace filesystem operations reject traversal, symlinks and root mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-provider-safe-"));
  const outside = await mkdtemp(join(tmpdir(), "bb-workspace-provider-outside-"));
  try {
    await writeFile(join(root, "inside.txt"), "inside");
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(outside, join(root, "linked-dir"));
    await symlink(join(outside, "secret.txt"), join(root, "linked-file.txt"));

    await assert.rejects(() => createWorkspaceDirectory(root, "../escaped"), /outside the selected workspace/);
    await assert.rejects(() => createWorkspaceFile(root, "linked-dir/new.txt", "x"), /outside the selected workspace/);
    await assert.rejects(() => readWorkspaceFile(root, "linked-file.txt"), /outside the selected workspace/);
    await assert.rejects(() => writeWorkspaceFileSystemFile(root, "linked-file.txt", new TextEncoder().encode("changed"), false, true), /outside the selected workspace/);
    await assert.rejects(() => deleteWorkspacePath(root, "linked-file.txt", false), /outside the selected workspace/);
    await assert.rejects(() => renameWorkspacePath(root, "inside.txt", "linked-file.txt", true), /outside the selected workspace/);
    await assert.rejects(() => deleteWorkspacePath(root, ".", true), /workspace root cannot be deleted/);
    await assert.rejects(() => renameWorkspacePath(root, "inside.txt", ".", false), /workspace root cannot be renamed/);
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "outside");
    assert.equal(await readFile(join(root, "inside.txt"), "utf8"), "inside");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workspace directory entries and Quick Open results expose modification times", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-mtime-"));
  try {
    await writeFile(join(root, "entry.ts"), "export {};");
    const directoryEntry = await listWorkspace(root);
    const quickOpenEntry = await searchWorkspaceFiles(root, "entry.ts");
    assert.equal(typeof directoryEntry[0].mtimeMs, "number");
    assert.equal(typeof quickOpenEntry[0].mtimeMs, "number");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workbench filesystem reads and atomically writes bounded binary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-workspace-binary-"));
  try {
    const original = new Uint8Array([0, 1, 255, 65]);
    const created = await createWorkspaceFile(root, "asset.bin", original);
    assert.equal(created.path, "asset.bin");
    const loaded = await readWorkspaceFileSystemFile(root, "asset.bin");
    assert.deepEqual(Array.from(loaded.content), [0, 1, 255, 65]);
    const updated = new Uint8Array([255, 0, 127, 66, 10]);
    await writeWorkspaceFileSystemFile(root, "asset.bin", updated, false, true);
    const saved = await readWorkspaceFileSystemFile(root, "asset.bin");
    assert.deepEqual(Array.from(saved.content), [255, 0, 127, 66, 10]);
    await assert.rejects(() => readWorkspaceFile(root, "asset.bin"), /Binary files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
