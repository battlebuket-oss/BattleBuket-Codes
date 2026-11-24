import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ClaudeAgentSdkAdapter, CodexCliAdapter } from "../src/index";
import type { AgentEvent, AgentRunRequest, AgentProvider } from "@battlebuket/agent-contracts";

const liveSmokeEnabled = process.env.BATTLEBUKET_REAL_PROVIDER_SMOKE === "1";
const selectedProviders = new Set(
  (process.env.BATTLEBUKET_SMOKE_PROVIDERS ?? "codex,claude")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
);

function liveRequest(provider: AgentProvider, workspacePath: string): AgentRunRequest {
  const taskId = randomUUID();
  return {
    provider,
    workingDirectory: workspacePath,
    approvalMode: "read-only",
    task: {
      id: taskId,
      title: "Authenticated provider read-only smoke test",
      prompt: [
        "This is a short authenticated runtime smoke test.",
        "Do not inspect, create, edit, or delete files. Do not run commands or use tools.",
        "Reply with this exact single line and no other text:",
        "BATTLEBUKET_PROVIDER_SMOKE_OK"
      ].join("\n"),
      workspacePath,
      acceptanceCriteria: [{
        id: "exact-response",
        description: "Return the exact provider smoke marker without changing the workspace.",
        required: true
      }],
      risk: "low",
      createdAt: new Date().toISOString()
    }
  };
}

for (const provider of ["codex", "claude"] as const) {
  const enabled = liveSmokeEnabled && selectedProviders.has(provider);
  test(
    `live ${provider} authentication and read-only execution`,
    { skip: !enabled, timeout: 5 * 60 * 1000 },
    async () => {
      const workspacePath = await mkdtemp(join(tmpdir(), "battlebuket-provider-smoke-"));
      const adapter = provider === "codex" ? new CodexCliAdapter() : new ClaudeAgentSdkAdapter();
      const events: AgentEvent[] = [];
      try {
        assert.equal(
          await adapter.isAvailable(),
          true,
          `${provider} runtime must be installed, authenticated and available on this runner`
        );

        const result = await adapter.run(liveRequest(provider, workspacePath), event => {
          events.push(event);
        });

        assert.equal(result.status, "succeeded", result.summary);
        assert.ok(
          result.summary.includes("BATTLEBUKET_PROVIDER_SMOKE_OK"),
          `${provider} did not return the required smoke marker: ${result.summary}`
        );
        assert.deepEqual(result.changedFiles, [], "read-only smoke must not report changed files");
        assert.deepEqual(await readdir(workspacePath), [], "read-only smoke must leave the temporary workspace empty");
        assert.ok(events.some(event => event.type === "completed"), "adapter should emit a completed event");
      } finally {
        await rm(workspacePath, { recursive: true, force: true });
      }
    }
  );
}
