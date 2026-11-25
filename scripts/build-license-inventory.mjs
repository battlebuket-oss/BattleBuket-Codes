import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? "artifacts/battlebuket-codes.spdx.json";
const output = process.argv[3] ?? "artifacts/LICENSE-INVENTORY.csv";
const summaryPath = process.argv[4] ?? "artifacts/LICENSE-INVENTORY-SUMMARY.md";
const pnpmStore = path.resolve("node_modules/.pnpm");

function csv(value) {
  const text = value == null ? "" : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

function licenseFromManifest(manifest) {
  const license = manifest?.license;
  let value = "";
  if (typeof license === "string" && license.trim()) value = license.trim();
  else if (license && typeof license === "object" && typeof license.type === "string") value = license.type.trim();
  else {
    const licenses = manifest?.licenses;
    if (Array.isArray(licenses)) {
      const expressions = licenses
        .map(item => typeof item === "string" ? item : item && typeof item.type === "string" ? item.type : "")
        .map(item => item.trim())
        .filter(Boolean);
      if (expressions.length) value = expressions.join(" OR ");
    }
  }
  const reference = value.match(/^SEE LICENSE IN\\s+(.+)$/i)?.[1]?.trim() ?? "";
  return { value, reference };
}

function buildPnpmManifestIndex() {
  const index = new Map();
  if (!fs.existsSync(pnpmStore)) return index;

  for (const storeEntry of fs.readdirSync(pnpmStore, { withFileTypes: true })) {
    if (!storeEntry.isDirectory()) continue;
    const modulesRoot = path.join(pnpmStore, storeEntry.name, "node_modules");
    if (!fs.existsSync(modulesRoot)) continue;

    for (const packageEntry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!packageEntry.isDirectory() && !packageEntry.isSymbolicLink()) continue;
      if (packageEntry.name.startsWith("@")) {
        const scopePath = path.join(modulesRoot, packageEntry.name);
        if (!fs.existsSync(scopePath)) continue;
        for (const scopedEntry of fs.readdirSync(scopePath, { withFileTypes: true })) {
          if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
          const manifestPath = path.join(scopePath, scopedEntry.name, "package.json");
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (manifest.name && manifest.version) index.set(manifest.name + "@" + manifest.version, { manifest, manifestPath });
          } catch {
            // Package directories without readable manifests are not license evidence.
          }
        }
      } else {
        const manifestPath = path.join(modulesRoot, packageEntry.name, "package.json");
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (manifest.name && manifest.version) index.set(manifest.name + "@" + manifest.version, { manifest, manifestPath });
        } catch {
          // Package directories without readable manifests are not license evidence.
        }
      }
    }
  }
  return index;
}

function hasLicenseFile(manifestPath, reference = "") {
  if (!manifestPath) return false;
  const root = path.dirname(manifestPath);
  const candidates = [
    ...["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "NOTICE"],
    ...(reference ? [reference] : [])
  ];
  return candidates.some(name => fs.existsSync(path.resolve(root, name)));
}

if (!fs.existsSync(input)) throw new Error("SPDX SBOM does not exist: " + input);
const document = JSON.parse(fs.readFileSync(input, "utf8"));
if (!document || !Array.isArray(document.packages) || document.packages.length === 0) {
  throw new Error("SPDX SBOM is invalid or contains no package entries.");
}

const manifests = buildPnpmManifestIndex();
const npmComponents = document.packages.filter(pkg =>
  pkg && typeof pkg.name === "string" && pkg.SPDXID !== "SPDXRef-DOCUMENT" &&
  (pkg.externalRefs ?? []).some(ref => ref.referenceType === "purl" && String(ref.referenceLocator ?? "").startsWith("pkg:npm/"))
);
const entries = npmComponents
  .map(pkg => {
    const version = pkg.versionInfo ?? "";
    const manifestEntry = version ? manifests.get(pkg.name + "@" + version) : undefined;
    const manifestLicense = licenseFromManifest(manifestEntry?.manifest);
    const declared = pkg.licenseDeclared ?? "NOASSERTION";
    const concluded = pkg.licenseConcluded ?? "NOASSERTION";
    const spdxLicense = declared !== "NOASSERTION" && declared !== "NONE" ? declared
      : concluded !== "NOASSERTION" && concluded !== "NONE" ? concluded
      : "";
    const licenseFilePresent = hasLicenseFile(manifestEntry?.manifestPath, manifestLicense.reference);
    const expressionResolved = Boolean(spdxLicense || (manifestLicense.value && !manifestLicense.reference));
    const effectiveLicense = spdxLicense || (manifestLicense.reference
      ? "LICENSE-REFERENCE: " + manifestLicense.reference
      : manifestLicense.value || "UNKNOWN");
    const licenseEvidence = spdxLicense ? "SPDX license declaration"
      : manifestLicense.reference && licenseFilePresent ? "package.json license-file reference; human interpretation required"
      : manifestLicense.reference ? "package.json license-file reference is unresolved"
      : manifestLicense.value ? "installed package.json license field"
      : licenseFilePresent ? "license file present; expression unresolved"
      : "no license metadata found";
    const purl = (pkg.externalRefs ?? []).find(ref => ref.referenceType === "purl")?.referenceLocator ?? "";
    return {
      name: pkg.name,
      version,
      effectiveLicense,
      spdxDeclared: declared,
      spdxConcluded: concluded,
      packageJsonLicense: manifestLicense.value,
      licenseReference: manifestLicense.reference,
      licenseExpressionResolved: expressionResolved,
      licenseEvidence,
      licenseFilePresent: licenseFilePresent ? "yes" : "no",
      purl,
      supplier: pkg.supplier ?? "",
      downloadLocation: pkg.downloadLocation ?? ""
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

if (entries.length === 0) throw new Error("SPDX SBOM contains no npm package components (pkg:npm PURLs).");

const columns = [
  ["name", "name"],
  ["version", "version"],
  ["effective_license", "effectiveLicense"],
  ["spdx_license_declared", "spdxDeclared"],
  ["spdx_license_concluded", "spdxConcluded"],
  ["package_json_license", "packageJsonLicense"],
  ["license_reference", "licenseReference"],
  ["license_expression_resolved", "licenseExpressionResolved"],
  ["license_evidence", "licenseEvidence"],
  ["license_file_present", "licenseFilePresent"],
  ["purl", "purl"],
  ["supplier", "supplier"],
  ["download_location", "downloadLocation"]
];

const rows = [
  columns.map(([header]) => csv(header)).join(","),
  ...entries.map(entry => columns.map(([, key]) => csv(entry[key])).join(","))
];
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(output, rows.join("\n") + "\n", "utf8");

const byEvidence = new Map();
for (const entry of entries) byEvidence.set(entry.licenseEvidence, (byEvidence.get(entry.licenseEvidence) ?? 0) + 1);
const unknown = entries.filter(entry => entry.licenseEvidence === "no license metadata found");
const fileOnly = entries.filter(entry => entry.licenseEvidence === "license file present; expression unresolved");
const licenseReferences = entries.filter(entry => entry.licenseEvidence.startsWith("package.json license-file reference"));
const known = entries.filter(entry => entry.licenseExpressionResolved).length;
const summary = [
  "# Dependency license inventory",
  "",
  `- SPDX SBOM: ${input}`,
  `- npm package components in SPDX SBOM: ${entries.length}`,
  `- Non-npm SPDX components retained in SBOM but excluded from this npm license table: ${document.packages.length - entries.length - 1}`,
  `- Components with a machine-readable SPDX/package.json license expression: ${known}`,
  `- Components using package.json "SEE LICENSE IN" references: ${licenseReferences.length}`,
  `- Components with a license file but no resolved expression: ${fileOnly.length}`,
  `- Components with no license metadata: ${unknown.length}`,
  "",
  "## Evidence source counts",
  ...[...byEvidence.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([source, count]) => `- ${source}: ${count}`),
  "",
  unknown.length || fileOnly.length
    ? "## Components requiring manual review\n\n" + [...fileOnly, ...unknown].map(entry => `- ${entry.name}${entry.version ? "@" + entry.version : ""} — ${entry.licenseEvidence}`).join("\n")
    : "All package components have a machine-readable license expression. This is an inventory result, not a legal compatibility determination.",
  "",
  "Review this inventory for license obligations, notices, copyleft/reciprocal terms, dual licensing, and transitive dependencies before release.",
  ""
].join("\n");

fs.writeFileSync(summaryPath, summary, "utf8");
console.log(summary);
if (unknown.length || fileOnly.length || licenseReferences.length) {
  console.warn("Manual license review required for " + (unknown.length + fileOnly.length + licenseReferences.length) + " package components.");
}
