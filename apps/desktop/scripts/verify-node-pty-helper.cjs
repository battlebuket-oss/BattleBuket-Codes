const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

if (process.platform !== "darwin") {
  console.log("node-pty macOS spawn-helper verification skipped on " + process.platform + ".");
  process.exit(0);
}

const requireFromDesktop = createRequire(path.join(__dirname, "..", "package.json"));
const entry = requireFromDesktop.resolve("node-pty");
const packageRoot = path.resolve(path.dirname(entry), "..");
const architecture = process.arch;
const candidates = [
  path.join(packageRoot, "prebuilds", "darwin-" + architecture, "spawn-helper"),
  path.join(packageRoot, "build", "Release", "spawn-helper"),
  path.join(packageRoot, "build", "Debug", "spawn-helper")
];

const helper = candidates.find(candidate => fs.existsSync(candidate));
if (!helper) {
  throw new Error(
    "node-pty spawn-helper is missing for darwin-" + architecture + ". Checked: " +
    candidates.join(", ")
  );
}

const stat = fs.statSync(helper);
if (!stat.isFile() || (stat.mode & 0o111) === 0) {
  throw new Error(
    "node-pty spawn-helper must be an executable regular file. " +
    helper + " has mode " + (stat.mode & 0o777).toString(8) +
    ". Upgrade node-pty; do not ship a helper without its execute bit."
  );
}

fs.accessSync(helper, fs.constants.X_OK);
console.log("node-pty macOS spawn-helper is executable: " + helper);
