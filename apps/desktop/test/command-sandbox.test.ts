import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { prepareSandboxedCommand } from "../src/main/command-sandbox";

test("OS command sandbox allows workspace writes but blocks host-home writes and loopback networking", {
  skip: process.platform === "win32",
  timeout: 20_000
}, async () => {
  const workspace = await fs.mkdtemp(join(tmpdir(), "bb-sandbox-workspace-"));
  const outside = join("/var/tmp", "battlebuket-sandbox-sentinel-" + randomUUID());
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
      "fs.writeFileSync('write-proof.txt', 'workspace-write-allowed');",
      "const outsideContents = fs.readFileSync(outside, 'utf8');",
      "if (outsideContents !== 'host-sentinel-must-not-change') process.exit(8);",
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
      ["-e", script, outside, "sandbox-result.json", String(address.port)],
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

test("Windows AppContainer writes only in its managed profile storage and blocks host access/network", {
  skip: process.platform !== "win32",
  timeout: 60_000
}, async () => {
  const workspace = await fs.mkdtemp(join(tmpdir(), "bb-appcontainer-workspace-"));
  const outside = join(tmpdir(), "battlebuket-appcontainer-sentinel-" + randomUUID() + ".txt");
  const sentinel = "host-sentinel-must-not-change-" + randomUUID();
  const server = createServer(socket => socket.end("host-network-reached"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await fs.writeFile(outside, sentinel, { encoding: "utf8", flag: "wx", mode: 0o600 });

  try {
    const script = [
      "const fs = require('node:fs');",
      "const net = require('node:net');",
      "const [outside, portText] = process.argv.slice(2);",
      "fs.writeFileSync('workspace-write-proof.txt', 'workspace-write-allowed');",
      "let outsideReadBlocked = false;",
      "try { fs.readFileSync(outside, 'utf8'); } catch { outsideReadBlocked = true; }",
      "let outsideWriteBlocked = false;",
      "try { fs.writeFileSync(outside, 'host-write-forbidden'); } catch { outsideWriteBlocked = true; }",
      "const finish = networkBlocked => {",
      "  const result = { outsideReadBlocked, outsideWriteBlocked, networkBlocked };",
      "  console.log('BATTLEBUKET_APP_CONTAINER_RESULT=' + JSON.stringify(result));",
      "  if (!networkBlocked || !outsideReadBlocked || !outsideWriteBlocked) process.exit(7);",
      "  process.exit(0);",
      "};",
      "const socket = net.createConnection({ host: '127.0.0.1', port: Number(portText) });",
      "socket.setTimeout(2000, () => { socket.destroy(); finish(true); });",
      "socket.once('connect', () => { socket.destroy(); finish(false); });",
      "socket.once('error', () => finish(true));"
    ].join("\n");
    const scriptPath = join(workspace, "appcontainer-probe.cjs");
    await fs.writeFile(scriptPath, script, { encoding: "utf8", flag: "wx" });
    const command = await prepareSandboxedCommand(
      workspace,
      process.execPath,
      ["appcontainer-probe.cjs", outside, String(address.port)],
      {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        SystemDrive: process.env.SystemDrive,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
      }
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
      assert.equal(exitCode, 0, "AppContainer probe failed: " + stdout + "\n" + stderr);
      assert.ok(stdout.includes("BATTLEBUKET_APP_CONTAINER_RESULT="), "sandbox child did not return its boundary probe result: " + stdout);
      assert.ok(stdout.includes('"outsideReadBlocked":true'), stdout);
      assert.ok(stdout.includes('"outsideWriteBlocked":true'), stdout);
      assert.ok(stdout.includes('"networkBlocked":true'), stdout);
      assert.equal(await fs.readFile(join(command.cwd, "workspace-write-proof.txt"), "utf8"), "workspace-write-allowed");
      assert.equal(await fs.readFile(outside, "utf8"), sentinel);
      assert.deepEqual(
        (await fs.readdir(workspace)).sort(),
        ["appcontainer-probe.cjs"],
        "the selected workspace must remain unchanged"
      );
    } finally {
      await command.dispose();
    }
  } finally {
    server.close();
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});
