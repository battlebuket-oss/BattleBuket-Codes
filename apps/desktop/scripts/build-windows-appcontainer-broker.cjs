const { spawnSync } = require("node:child_process");
const { mkdirSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");

if (process.platform !== "win32") {
  process.exit(0);
}

const project = resolve(process.cwd(), "windows", "AppContainerBroker", "AppContainerBroker.csproj");
const output = resolve(process.cwd(), "resources", "windows", "publish");
const executable = join(output, "BattleBuket.AppContainerBroker.exe");

mkdirSync(output, { recursive: true });
const result = spawnSync("dotnet", [
  "publish",
  project,
  "--configuration", "Release",
  "--runtime", "win-x64",
  "--self-contained", "true",
  "-p:PublishSingleFile=true",
  "-p:IncludeNativeLibrariesForSelfExtract=true",
  "--output", output
], { stdio: "inherit", windowsHide: true });

if (result.error) {
  throw new Error("The Windows AppContainer broker could not be built. Install the .NET 8 SDK before building Windows packages: " + result.error.message);
}
if (result.status !== 0) {
  throw new Error("The Windows AppContainer broker build failed with exit code " + String(result.status));
}
const info = statSync(executable);
if (!info.isFile() || info.size < 50_000) {
  throw new Error("The Windows AppContainer broker executable is missing or unexpectedly small.");
}
console.log("Windows AppContainer broker built: " + executable + " (" + info.size + " bytes)");
