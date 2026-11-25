import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? "artifacts/battlebuket-codes.spdx.json";
const output = process.argv[3] ?? "artifacts/LICENSE-INVENTORY.csv";
const summaryPath = process.argv[4] ?? "artifacts/LICENSE-INVENTORY-SUMMARY.md";

function csv(value) {
  const text = value == null ? "" : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

if (!fs.existsSync(input)) {
  throw new Error("SPDX SBOM does not exist: " + input);
}

const document = JSON.parse(fs.readFileSync(input, "utf8"));
if (!document || !Array.isArray(document.packages) || document.packages.length === 0) {
  throw new Error("SPDX SBOM is invalid or contains no package entries.");
}

const excluded = new Set(["SPDXRef-DOCUMENT"]);
const entries = document.packages
  .filter(pkg => pkg && typeof pkg.name === "string" && !excluded.has(pkg.SPDXID))
  .map(pkg => {
    const declared = pkg.licenseDeclared ?? "NOASSERTION";
    const concluded = pkg.licenseConcluded ?? "NOASSERTION";
    const license = declared !== "NOASSERTION" && declared !== "NONE" ? declared
      : concluded !== "NOASSERTION" && concluded !== "NONE" ? concluded
      : "UNKNOWN";
    return {
      name: pkg.name,
      version: pkg.versionInfo ?? "",
      license,
      declared,
      concluded,
      purl: (pkg.externalRefs ?? []).find(ref => ref.referenceType === "purl")?.referenceLocator ?? "",
      supplier: pkg.supplier ?? "",
      downloadLocation: pkg.downloadLocation ?? ""
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

if (entries.length === 0) {
  throw new Error("SPDX SBOM contains no usable package components.");
}

const header = ["name", "version", "effective_license", "license_declared", "license_concluded", "purl", "supplier", "download_location"];
const rows = [header, ...entries.map(entry => header.map(key => entry[key]))]
  .map(row => row.map(csv).join(","))
  .join("\n") + "\n";

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(output, rows, "utf8");

const unknown = entries.filter(entry => entry.license === "UNKNOWN");
const known = entries.length - unknown.length;
const summary = [
  "# Dependency license inventory",
  "",
  `- SBOM: ${input}`,
  `- Package components: ${entries.length}`,
  `- Components with declared/concluded license metadata: ${known}`,
  `- Components requiring manual license identification: ${unknown.length}`,
  "",
  unknown.length
    ? "## Components requiring manual review\n\n" + unknown.map(entry => `- ${entry.name}${entry.version ? "@" + entry.version : ""}`).join("\n")
    : "All package entries include a declared or concluded SPDX license expression. This is an inventory result, not a legal compatibility determination.",
  "",
  "Review this inventory for license obligations, notices, copyleft/reciprocal terms, dual licensing, and transitive dependencies before release.",
  ""
].join("\n");

fs.writeFileSync(summaryPath, summary, "utf8");
console.log(summary);
if (unknown.length > 0) {
  console.warn("Manual license review required for " + unknown.length + " package components.");
}
