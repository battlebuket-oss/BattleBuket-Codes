import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? "artifacts/pnpm-audit.json";
const csvPath = process.argv[3] ?? "artifacts/PNPM-AUDIT.csv";
const summaryPath = process.argv[4] ?? "artifacts/PNPM-AUDIT-SUMMARY.md";

function csv(value) {
  return '"' + String(value ?? "").replaceAll('"', '""') + '"';
}

function json(value) {
  try { return JSON.stringify(value ?? ""); }
  catch { return String(value ?? ""); }
}

function normalizeFixAvailable(value) {
  if (typeof value === "string") return value;
  if (value === true) return "available";
  if (!value) return "";
  if (typeof value === "object") {
    const parts = [];
    if (typeof value.name === "string") parts.push(value.name);
    if (typeof value.version === "string") parts.push("version " + value.version);
    if (value.isSemVerMajor === true) parts.push("(major upgrade)");
    return parts.join(" ") || json(value);
  }
  return String(value);
}

function normalizeDirectness(value) {
  return value === true || value === "direct" ? "direct" : "transitive";
}

function addRow(rows, row) {
  const paths = [...new Set((Array.isArray(row.paths) ? row.paths : [])
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim()))];
  rows.push({
    package: row.package ?? "",
    severity: String(row.severity ?? "unknown").toLowerCase(),
    directness: row.directness ?? normalizeDirectness(row.isDirect),
    dependencyPaths: paths.join(" | "),
    currentVersions: row.currentVersions ?? "",
    range: row.range ?? "",
    patchedVersions: row.patchedVersions ?? "",
    advisory: row.advisory ?? "Untitled advisory",
    recommendation: row.recommendation ?? "",
    fixAvailable: normalizeFixAvailable(row.fixAvailable),
    url: row.url ?? ""
  });
}

if (!fs.existsSync(input)) throw new Error("pnpm audit JSON file does not exist: " + input);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = [];
const vulnerabilities = report.vulnerabilities ?? report.audit?.vulnerabilities;
const advisories = report.advisories ?? report.audit?.advisories;

if (vulnerabilities && typeof vulnerabilities === "object") {
  for (const [packageName, item] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(item.via) ? item.via : [];
    const details = via.filter(value => value && typeof value === "object");
    const paths = Array.isArray(item.paths) ? item.paths : [];
    const fixAvailable = item.fixAvailable;
    if (!details.length) {
      addRow(rows, {
        package: packageName,
        severity: item.severity,
        isDirect: item.isDirect,
        paths,
        range: item.range,
        currentVersions: Array.isArray(item.installedVersions) ? item.installedVersions.join("; ") : "",
        advisory: "No individual advisory detail was supplied",
        fixAvailable,
        recommendation: normalizeFixAvailable(fixAvailable)
      });
    } else {
      for (const detail of details) {
        addRow(rows, {
          package: packageName,
          severity: detail.severity ?? item.severity,
          isDirect: item.isDirect,
          paths,
          range: detail.range ?? item.range,
          currentVersions: Array.isArray(item.installedVersions) ? item.installedVersions.join("; ") : "",
          advisory: detail.title ?? detail.name,
          url: detail.url,
          fixAvailable,
          recommendation: normalizeFixAvailable(fixAvailable)
        });
      }
    }
  }
} else if (advisories && typeof advisories === "object") {
  for (const advisory of Object.values(advisories)) {
    const findings = Array.isArray(advisory.findings) ? advisory.findings : [{}];
    const versions = [...new Set(findings.map(finding => finding.version).filter(Boolean))].sort();
    const paths = [...new Set(findings.flatMap(finding => finding.paths ?? []))];
    const directness = paths.some(value => typeof value === "string" && value.split(" > ").length <= 2)
      ? "direct"
      : "transitive";
    const recommendation = advisory.recommendation ?? "";
    const patched = advisory.patched_versions ?? "";
    const upgradeMatch = recommendation.match(/upgrade to version ([^\s,;]+(?:\s+or later)?)/i);
    const fixAvailable = upgradeMatch ? upgradeMatch[1] : patched;
    addRow(rows, {
      package: advisory.module_name ?? advisory.name,
      severity: advisory.severity,
      directness,
      paths,
      currentVersions: versions.join("; "),
      range: advisory.vulnerable_versions,
      patchedVersions: patched,
      advisory: advisory.title,
      recommendation,
      url: advisory.url,
      fixAvailable
    });
  }
}

const severityRank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };
rows.sort((a, b) =>
  (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5) ||
  a.package.localeCompare(b.package) ||
  a.advisory.localeCompare(b.advisory)
);
const headers = [
  "package", "severity", "directness", "dependency_paths", "current_versions",
  "affected_range", "patched_versions", "advisory", "recommendation", "fix_available", "url"
];
const columns = [
  "package", "severity", "directness", "dependencyPaths", "currentVersions",
  "range", "patchedVersions", "advisory", "recommendation", "fixAvailable", "url"
];
const csvRows = [
  headers.map(csv).join(","),
  ...rows.map(row => columns.map(key => csv(row[key])).join(","))
];
fs.mkdirSync(path.dirname(csvPath), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(csvPath, csvRows.join("\n") + "\n", "utf8");

const totals = report.metadata?.vulnerabilities ?? report.metadata?.audit?.vulnerabilities ?? {};
const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 };
for (const row of rows) counts[row.severity] = (counts[row.severity] ?? 0) + 1;
const packagesWithRecommendation = new Set(rows.filter(row => row.recommendation).map(row => row.package));
const summary = [
  "# pnpm dependency audit report",
  "",
  "- Source: " + input,
  "- Advisory entries: " + rows.length,
  "- Critical: " + (totals.critical ?? counts.critical),
  "- High: " + (totals.high ?? counts.high),
  "- Moderate: " + (totals.moderate ?? counts.moderate),
  "- Low: " + (totals.low ?? counts.low),
  "- Info: " + (totals.info ?? counts.info),
  "- Packages with an upstream remediation recommendation: " + packagesWithRecommendation.size,
  "",
  "The CI gate separately fails on high-severity or critical advisories. This report records all lower-severity findings and upstream remediation guidance; apply upgrades and rerun regression tests before treating them as resolved.",
  "",
  "## Findings",
  "",
  ...(rows.length
    ? rows.map(row => {
        const current = row.currentVersions ? " (installed: " + row.currentVersions + ")" : "";
        const patched = row.patchedVersions ? "; patched range: " + row.patchedVersions : "";
        const recommendation = row.recommendation ? "; recommendation: " + row.recommendation : "";
        const paths = row.dependencyPaths ? "; dependency paths: " + row.dependencyPaths : "";
        return "- **" + row.severity.toUpperCase() + "** " + row.package + current + ": " + row.advisory +
          " (affected: " + (row.range || "not supplied") + patched + ")" + recommendation + paths +
          (row.url ? " — " + row.url : "");
      })
    : ["No advisories were reported by pnpm audit."],
  ""
].join("\n");
fs.writeFileSync(summaryPath, summary, "utf8");
console.log(summary);
