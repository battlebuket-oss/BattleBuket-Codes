import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateTerminalInput, validateTerminalSize, WorkspaceTerminalSessions } from "../src/main/terminal-sessions";

test("validates PTY input and resize bounds", () => {
  assert.throws(() => validateTerminalInput(""), /Terminal input/);
  assert.throws(() => validateTerminalInput("x".repeat(64 * 1024 + 1)), /Terminal input/);
  assert.doesNotThrow(() => validateTerminalInput("\u0003"));
  assert.throws(() => validateTerminalSize(10, 28), /Terminal size/);
  assert.throws(() => validateTerminalSize(100, 500), /Terminal size/);
  assert.doesNotThrow(() => validateTerminalSize(100, 28));
});

test("PTY session preserves shell state, streams output, resizes and exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-pty-session-"));
  const sessions = new WorkspaceTerminalSessions();
  const sessionId = randomUUID();
  const seen = new Set<string>();
  let exitSeen = false;
  const waitFor = async (marker: string) => {
    const deadline = Date.now() + 10000;
    while (!seen.has(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(seen.has(marker), "PTY output did not contain " + marker);
  };
  try {
    await sessions.start(sessionId, root, event => {
      if (event.type === "output" && event.text) {
        if (event.text.includes("BB_PTY_FIRST")) seen.add("first");
        if (event.text.includes("BB_PTY_STATE_OK")) seen.add("state");
        if (event.text.includes("BB_PTY_SECOND")) seen.add("second");
      }
      if (event.type === "exit") exitSeen = true;
    });
    sessions.resize(sessionId, 120, 32);
    const first = process.platform === "win32"
      ? "set BB_PTY_MARKER=BB_PTY_\r\necho BB_PTY_FIRST\r"
      : "export BB_PTY_MARKER=BB_PTY_; printf 'BB_PTY_FIRST\\n'\r";
    const second = process.platform === "win32"
      ? "set BB_PTY_MARKER=%BB_PTY_MARKER%STATE_OK\r\necho %BB_PTY_MARKER% & echo BB_PTY_SECOND\r"
      : "printf '%s\\n' \"\${BB_PTY_MARKER}STATE_OK\"; printf 'BB_PTY_SECOND\\n'\r";
    sessions.write(sessionId, first);
    await waitFor("first");
    sessions.write(sessionId, second);
    await waitFor("state");
    await waitFor("second");
    const firstClose = sessions.close(sessionId);
    assert.equal(sessions.hasActiveSession(), true, "a terminating PTY remains active until its exit is confirmed");
    const concurrentClose = sessions.close(sessionId);
    assert.equal(await firstClose, true);
    assert.equal(await concurrentClose, true);
    await sessions.closeAll();
    assert.equal(exitSeen, true);
    assert.equal(sessions.hasActiveSession(), false);
  } finally {
    await sessions.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
