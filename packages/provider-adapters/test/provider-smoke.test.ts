import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execa } from "execa";
import { CodexCliAdapter, ClaudeAgentSdkAdapter } from "../src/index";
import type { AgentAdapter, AgentRunRequest } from "@battlebuket/agent-contracts";

const enabled = process.env.BATTLEBUKET_REAL_PROVIDER_SMOKE === "1";
const selected = new Set((process.env.BATTLEBUKET_SMOKE_PROVIDERS ?? "codex,claude").split(",").map(value => value.trim()));

function createRequest(provider: AgentAdapter["provider"], workspacePath: string, approvalMode: AgentRunRequest["approvalMode"], prompt: string): AgentRunRequest {
  return {
    provider,
    workingDirectory: workspacePath,
    approvalMode,
    task: {
      id: randomUUID(),
      title: "Provider smoke test",
      prompt,
      workspacePath,
      acceptanceCriteria: [{ id: "smoke", description: "Meet the provider smoke test request without touching files outside the workspace.", required: true }],
      risk: approvalMode === "workspace-write" ? "medium" : "low",
      createdAt: new Date().toISOString()
    }
  };
}

async function createGitWorkspace(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await execa("git", ["init", "--quiet"], { cwd: root });
  await execa("git", ["config", "user.name", "BattleBuket Smoke Test"], { cwd: root });
  await execa("git", ["config", "user.email", "smoke-test@battlebuket.invalid"], { cwd: root });
  await fs.writeFile(join(root, "README.md"), "A harmless provider adapter smoke-test workspace.\n", "utf8");
  await execa("git", ["add", "README.md"], { cwd: root });
  await execa("git", ["commit", "--quiet", "-m", "smoke-test baseline"], { cwd: root });
}

const adapters: AgentAdapter[] = [new CodexCliAdapter(), new ClaudeAgentSdkAdapter()];
for (const adapter of adapters) {
  const shouldRun = enabled && selected.has(adapter.provider);

  test(adapter.provider + " live authenticated read-only execution", { skip: !shouldRun }, async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), "battlebuket-provider-readonly-"));
    const workspace = join(parent, "workspace");
    try {
      await createGitWorkspace(workspace);
      assert.equal(await adapter.isAvailable(), true, adapter.provider + " must be installed and authenticated on this runner");
      const result = await adapter.run(
        createRequest(adapter.provider, workspace, "read-only", "Read README.md only. Do not create, edit, delete, or execute anything. Finish with a brief confirmation."),
        () => {}
      );
      assert.equal(result.status, "succeeded", result.summary);
      assert.deepEqual((await fs.readdir(workspace)).sort(), [".git", "README.md"]);
      assert.deepEqual(result.changedFiles, []);
    } finally { await fs.rm(parent, { recursive: true, force: true }); }
  });

  test(adapter.provider + " live workspace-write boundary execution", { skip: !shouldRun }, async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), "battlebuket-provider-write-"));
    const workspace = join(parent, "workspace");
    const outside = join(parent, "outside-sentinel.txt");
    try {
      await createGitWorkspace(workspace);
      await fs.writeFile(outside, "outside-sentinel-must-remain-unchanged", "utf8");
      assert.equal(await adapter.isAvailable(), true, adapter.provider + " must be installed and authenticated on this runner");
      const result = await adapter.run(
        createRequest(adapter.provider, workspace, "workspace-write", "Create exactly one file named smoke-generated.txt in the current workspace with the text BATTLEBUKET_PROVIDER_SMOKE_OK. Do not edit or create any other files."),
        () => {}
      );
      assert.equal(result.status, "succeeded", result.summary);
      assert.equal(await fs.readFile(join(workspace, "smoke-generated.txt"), "utf8"), "BATTLEBUKET_PROVIDER_SMOKE_OK");
      assert.equal(await fs.readFile(outside, "utf8"), "outside-sentinel-must-remain-unchanged");
      assert.ok(result.changedFiles.includes("smoke-generated.txt"), JSON.stringify(result.changedFiles));
    } finally { await fs.rm(parent, { recursive: true, force: true }); }
  });
}
