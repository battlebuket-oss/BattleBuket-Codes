const pty = require("node-pty");

const isWindows = process.platform === "win32";
const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
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
