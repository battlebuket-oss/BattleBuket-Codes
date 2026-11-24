import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateTerminalInput, WorkspaceTerminalSessions } from "../src/main/terminal-sessions";

test("validates terminal input length and rejects NUL characters", () => {
  assert.throws(() => validateTerminalInput(""), /Terminal input/);
  assert.throws(() => validateTerminalInput("bad\0input"), /Terminal input/);
  assert.doesNotThrow(() => validateTerminalInput("echo hello\n"));
});

test("maintains one shell session across multiple commands and closes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-terminal-session-"));
  const sessions = new WorkspaceTerminalSessions();
  const sessionId = randomUUID();
  const seen = new Set<string>();
  const waitFor = async (marker: string) => {
    const deadline = Date.now() + 8000;
    while (!seen.has(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(seen.has(marker), "terminal output did not contain " + marker);
  };
  try {
    await sessions.start(sessionId, root, event => {
      if (event.type === "output" && event.text) {
        if (event.text.includes("BB_SESSION_FIRST")) seen.add("first");
        if (event.text.includes("BB_SESSION_SECOND")) seen.add("second");
      }
    });
    const first = process.platform === "win32"
      ? "set BB_SESSION_MARKER=SESSION_STATE_OK\\r\\necho BB_SESSION_FIRST\\r\\n"
      : "export BB_SESSION_MARKER=SESSION_STATE_OK; printf 'BB_SESSION_FIRST\\\\n'\\n";
    const second = process.platform === "win32"
      ? "echo %BB_SESSION_MARKER% & echo BB_SESSION_SECOND\\r\\n"
      : "printf '%s\\\\n' \"$BB_SESSION_MARKER\"; printf 'BB_SESSION_SECOND\\\\n'\\n";
    sessions.write(sessionId, first);
    await waitFor("first");
    sessions.write(sessionId, second);
    await waitFor("state");
    await waitFor("second");
    assert.equal(await sessions.close(sessionId), true);
    assert.equal(sessions.hasActiveSession(), false);
  } finally {
    await sessions.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
