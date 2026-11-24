import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runWorkspaceCommand, validateTerminalCommand } from "../src/main/terminal";

test("terminal command validation rejects empty, non-string and oversized commands", () => {
  assert.throws(() => validateTerminalCommand("  "), /Enter a terminal command/);
  assert.throws(() => validateTerminalCommand(null), /Enter a terminal command/);
  assert.throws(() => validateTerminalCommand("x".repeat(4001)), /Enter a terminal command/);
  assert.doesNotThrow(() => validateTerminalCommand("pwd"));
});

test("workspace terminal runs a user-entered command in the selected directory", async () => {
  const directory = await mkdtemp(tmpdir() + "/battlebuket-terminal-");
  try {
    const result = await runWorkspaceCommand(directory, process.platform === "win32" ? "cd" : "pwd");
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.trim().length > 0);
    assert.equal(result.timedOut, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});