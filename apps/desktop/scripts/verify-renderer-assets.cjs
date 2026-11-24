const fs = require("node:fs");
const path = require("node:path");

const rendererDir = path.resolve(__dirname, "..", "out", "renderer");
const htmlPath = path.join(rendererDir, "index.html");
const assetsDir = path.join(rendererDir, "assets");

if (!fs.existsSync(htmlPath)) {
  throw new Error("Renderer build is missing out/renderer/index.html.");
}
if (!fs.existsSync(assetsDir)) {
  throw new Error("Renderer build is missing out/renderer/assets.");
}

const html = fs.readFileSync(htmlPath, "utf8");
const assetReferences = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map(match => match[1])
  .filter(value => !/^(?:data:|https?:|#)/i.test(value));

const invalidReferences = assetReferences.filter(value => value.startsWith("/") || value.startsWith("\\"));
if (invalidReferences.length > 0) {
  throw new Error(
    "Packaged renderer contains root-relative assets that do not resolve under file://: " +
    invalidReferences.join(", ")
  );
}

const assetFiles = fs.readdirSync(assetsDir);
const workerFiles = assetFiles.filter(name => /worker/i.test(name) && /\.(?:js|mjs)$/i.test(name));
if (workerFiles.length < 6) {
  throw new Error(
    "Expected six or more separately bundled Monaco/VS Code workers, found " +
    workerFiles.length + ": " + workerFiles.join(", ")
  );
}

const jsFiles = assetFiles.filter(name => /\.(?:js|mjs)$/i.test(name));
if (jsFiles.length === 0) throw new Error("Renderer build emitted no JavaScript assets.");

console.log("Renderer asset verification passed.");
console.log("Relative HTML assets: " + assetReferences.join(", "));
console.log("Bundled worker assets (" + workerFiles.length + "): " + workerFiles.join(", "));
