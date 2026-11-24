import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { prepareSandboxedCommand } from "../src/main/command-sandbox";

test("OS command sandbox allows workspace writes but blocks host-home writes and loopback networking", {
  skip: process.platform === "win32",
  timeout: 20_000
}, async () => {
  const workspace = await fs.mkdtemp(join(tmpdir(), "bb-sandbox-workspace-"));
  const outside = join(homedir(), ".battlebuket-sandbox-sentinel-" + randomUUID());
  const workspaceResult = join(workspace, "sandbox-result.json");
  const server = createServer(socket => socket.end("host-network-reached"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await fs.writeFile(outside, "host-sentinel-must-not-change", { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    const script = [
      "const fs = require('node:fs');",
      "const net = require('node:net');",
      "const [outside, resultPath, portText] = process.argv.slice(1);",
      "fs.writeFileSync('/tmp/battlebuket-sandbox/workspace/write-proof.txt', 'workspace-write-allowed');",
      "let outsideWriteBlocked = false;",
      "try { fs.writeFileSync(outside, 'host-write-forbidden'); } catch { outsideWriteBlocked = true; }",
      "const finish = networkBlocked => {",
      "  if (!networkBlocked || !outsideWriteBlocked) process.exit(7);",
      "  fs.writeFileSync(resultPath, JSON.stringify({ outsideWriteBlocked, networkBlocked }));",
      "  process.exit(0);",
      "};",
      "const socket = net.createConnection({ host: '127.0.0.1', port: Number(portText) });",
      "socket.setTimeout(2500, () => { socket.destroy(); finish(true); });",
      "socket.once('connect', () => { socket.destroy(); finish(false); });",
      "socket.once('error', () => finish(true));"
    ].join("\n");
    const command = await prepareSandboxedCommand(
      workspace,
      process.execPath,
      ["-e", script, outside, "/tmp/battlebuket-sandbox/workspace/sandbox-result.json", String(address.port)],
      { PATH: process.env.PATH, CI: "1" }
    );
    try {
      const child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: command.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", chunk => { stdout += String(chunk); });
      child.stderr?.on("data", chunk => { stderr += String(chunk); });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => resolve(code));
      });
      assert.equal(exitCode, 0, "sandboxed probe failed: " + stdout + "\n" + stderr);
      assert.equal(await fs.readFile(join(workspace, "write-proof.txt"), "utf8"), "workspace-write-allowed");
      assert.deepEqual(JSON.parse(await fs.readFile(workspaceResult, "utf8")), {
        outsideWriteBlocked: true,
        networkBlocked: true
      });
      assert.equal(await fs.readFile(outside, "utf8"), "host-sentinel-must-not-change");
    } finally {
      await command.dispose();
    }
  } finally {
    server.close();
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});

test("Windows command execution is explicitly rejected until an AppContainer broker exists", {
  skip: process.platform !== "win32"
}, async () => {
  const workspace = await fs.mkdtemp(join(tmpdir(), "bb-sandbox-windows-"));
  try {
    await assert.rejects(
      () => prepareSandboxedCommand(workspace, process.execPath, ["-e", "process.exit(0)"], process.env),
      /AppContainer/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
