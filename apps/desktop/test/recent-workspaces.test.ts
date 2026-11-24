import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRecentWorkspace, readRecentWorkspaces, recordRecentWorkspace } from "../src/main/recent-workspaces";

test("records, deduplicates and bounds recent workspaces", async () => {
  const userData = await mkdtemp(join(tmpdir(), "bb-recent-"));
  const projects = await mkdtemp(join(tmpdir(), "bb-projects-"));
  try {
    const paths: string[] = [];
    for (let index = 0; index < 12; index++) {
      const path = join(projects, "project-" + index);
      await mkdir(path);
      paths.push(path);
    }
    const canonicalPaths = await Promise.all(paths.map(path => realpath(path)));
    for (const path of paths) await recordRecentWorkspace(userData, path);
    await recordRecentWorkspace(userData, paths[11]);

    const recent = await readRecentWorkspaces(userData);
    assert.equal(recent.length, 10);
    assert.equal(recent[0].path, canonicalPaths[11]);
    assert.equal(recent.filter(item => item.path === canonicalPaths[11]).length, 1);
    assert.equal(await openRecentWorkspace(userData, paths[11]), canonicalPaths[11]);
    await assert.rejects(() => openRecentWorkspace(userData, paths[0]), /not in the recent workspace list/);
  } finally {
    await rm(userData, { recursive: true, force: true });
    await rm(projects, { recursive: true, force: true });
  }
});

test("drops missing and non-directory recent paths and rejects tampered paths on open", async () => {
  const userData = await mkdtemp(join(tmpdir(), "bb-recent-"));
  const project = await mkdtemp(join(tmpdir(), "bb-project-"));
  const outside = await mkdtemp(join(tmpdir(), "bb-outside-"));
  try {
    const recentFile = join(userData, "recent-workspaces.json");
    await writeFile(recentFile, JSON.stringify([
      { path: project, lastOpenedAt: new Date().toISOString() },
      { path: join(outside, "missing"), lastOpenedAt: new Date().toISOString() },
      { path: recentFile, lastOpenedAt: new Date().toISOString() }
    ]));
    const recent = await readRecentWorkspaces(userData);
    assert.deepEqual(recent.map(item => item.path), [await realpath(project)]);
    await writeFile(recentFile, JSON.stringify([{ path: outside, lastOpenedAt: "invalid" }]));
    await assert.rejects(() => openRecentWorkspace(userData, outside), /not in the recent workspace list/);
  } finally {
    await rm(userData, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("ignores a symlinked recent-workspace file", async () => {
  const userData = await mkdtemp(join(tmpdir(), "bb-recent-"));
  const outside = await mkdtemp(join(tmpdir(), "bb-recent-outside-"));
  try {
    const target = join(outside, "recent.json");
    await writeFile(target, JSON.stringify([{ path: outside, lastOpenedAt: new Date().toISOString() }]));
    await symlink(target, join(userData, "recent-workspaces.json"));
    assert.deepEqual(await readRecentWorkspaces(userData), []);
  } finally {
    await rm(userData, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("serializes concurrent recent-project updates without losing the final selections", async () => {
  const userData = await mkdtemp(join(tmpdir(), "bb-recent-concurrent-"));
  const projects = await mkdtemp(join(tmpdir(), "bb-projects-concurrent-"));
  try {
    const paths: string[] = [];
    for (let index = 0; index < 8; index++) {
      const path = join(projects, "parallel-" + index);
      await mkdir(path);
      paths.push(path);
    }
    const canonicalPaths = await Promise.all(paths.map(path => realpath(path)));
    await Promise.all(paths.map(path => recordRecentWorkspace(userData, path)));
    const recent = await readRecentWorkspaces(userData);
    assert.equal(recent.length, paths.length);
    assert.deepEqual(new Set(recent.map(item => item.path)), new Set(canonicalPaths));
  } finally {
    await rm(userData, { recursive: true, force: true });
    await rm(projects, { recursive: true, force: true });
  }
});
