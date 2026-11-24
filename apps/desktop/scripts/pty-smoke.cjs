const pty = require("node-pty");

const fs = require("node:fs");
const path = require("node:path");
const isWindows = process.platform === "win32";
const shell = isWindows
  ? (process.env.ComSpec || process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "cmd.exe") || "cmd.exe")
  : [...new Set([process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh", "/usr/bin/bash"])]
      .filter(candidate => typeof candidate === "string" && path.isAbsolute(candidate))
      .find(candidate => {
        try { fs.accessSync(candidate, fs.constants.X_OK); return true; }
        catch { return false; }
      });
if (!shell) throw new Error("No executable shell was found for the native PTY smoke test.");
const args = isWindows ? ["/D"] : ["-i"];
const safeEnv = {};
const allowedEnv = [
  "PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "SHELL", "ComSpec", "SystemRoot", "WINDIR", "SystemDrive",
  "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA",
  "LANG", "LC_ALL", "USER", "LOGNAME", "USERNAME", "PATHEXT"
];
for (const key of allowedEnv) {
  if (typeof process.env[key] === "string") safeEnv[key] = process.env[key];
}
if (!isWindows && !safeEnv.PATH) safeEnv.PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
safeEnv.TERM = "xterm-256color";
safeEnv.COLORTERM = "truecolor";
const child = pty.spawn(shell, args, {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: safeEnv,
});

let output = "";
let exitRequested = false;
const timeout = setTimeout(() => {
  try { child.kill(); } catch {}
  process.stderr.write("PTY smoke test timed out.\n");
  process.exit(1);
}, 15000);

child.onData(data => {
  output += data;
  if (!exitRequested && output.includes("BB_PTY_SMOKE_OK")) {
    exitRequested = true;
    child.resize(100, 30);
    child.write("exit\r");
  }
});

child.onExit(({ exitCode, signal }) => {
  clearTimeout(timeout);
  const passed = output.includes("BB_PTY_SMOKE_OK") && exitCode === 0;
  if (!passed) {
    process.stderr.write("PTY smoke test failed. Exit: " + exitCode + ", signal: " + signal + "\n");
    process.stderr.write(output.slice(-4000));
    process.exit(1);
  }
  process.stdout.write("Native PTY smoke test passed on " + process.platform + ".\n");
  process.exit(0);
});

child.write(isWindows
  ? "set BB_PTY_MARKER=BB_PTY_\rset BB_PTY_MARKER=%BB_PTY_MARKER%SMOKE_OK\recho %BB_PTY_MARKER%\r"
  : "printf '%s%s\\n' 'BB_PTY_' 'SMOKE_OK'\r");
