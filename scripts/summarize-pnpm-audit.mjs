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

if (!fs.existsSync(input)) throw new Error("pnpm audit JSON file does not exist: " + input);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = [];
const vulnerabilities = report.vulnerabilities ?? report.audit?.vulnerabilities;
const advisories = report.advisories ?? report.audit?.advisories;

if (vulnerabilities && typeof vulnerabilities === "object") {
  for (const [packageName, item] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(item.via) ? item.via : [];
    const details = via.filter(value => value && typeof value === "object");
    if (!details.length) {
      rows.push({
        package: packageName,
        severity: item.severity ?? "unknown",
        direct: item.isDirect === true ? "direct" : "transitive",
        range: item.range ?? "",
        advisory: "No individual advisory detail was supplied",
        url: "",
        fixAvailable: json(item.fixAvailable)
      });
    } else {
      for (const detail of details) {
        rows.push({
          package: packageName,
          severity: detail.severity ?? item.severity ?? "unknown",
          direct: item.isDirect === true ? "direct" : "transitive",
          range: detail.range ?? item.range ?? "",
          advisory: detail.title ?? detail.name ?? "Untitled advisory",
          url: detail.url ?? "",
          fixAvailable: json(item.fixAvailable)
        });
      }
    }
  }
} else if (advisories && typeof advisories === "object") {
  for (const advisory of Object.values(advisories)) {
    for (const finding of advisory.findings ?? [{}]) {
      rows.push({
        package: advisory.module_name ?? advisory.name ?? "",
        severity: advisory.severity ?? "unknown",
        direct: finding.paths?.length ? "direct/indirect path listed" : "unknown",
        range: advisory.vulnerable_versions ?? "",
        advisory: advisory.title ?? "Untitled advisory",
        url: advisory.url ?? "",
        fixAvailable: json(advisory.fixAvailable)
      });
    }
  }
}

const severityRank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };
rows.sort((a, b) => (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5) || a.package.localeCompare(b.package));
const headers = ["package", "severity", "directness", "affected_range", "advisory", "url", "fix_available"];
const columns = ["package", "severity", "direct", "range", "advisory", "url", "fixAvailable"];
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
const packagesWithFix = new Set(rows.filter(row => row.fixAvailable && row.fixAvailable !== "false" && row.fixAvailable !== '""').map(row => row.package));
const summary = [
  "# pnpm dependency audit report",
  "",
  `- Source: ${input}`,
  `- Vulnerable package entries: ${rows.length}`,
  `- Critical: ${totals.critical ?? counts.critical}`,
  `- High: ${totals.high ?? counts.high}`,
  `- Moderate: ${totals.moderate ?? counts.moderate}`,
  `- Low: ${totals.low ?? counts.low}`,
  `- Info: ${totals.info ?? counts.info}`,
  `- Packages with a reported fix: ${packagesWithFix.size}`,
  "",
  "The CI gate separately fails on high-severity or critical advisories. This artifact records lower-severity findings and remediation metadata; each advisory still requires triage and upgrade/regression testing.",
  "",
  "## Findings",
  "",
  ...(rows.length
    ? rows.map(row => `- **${row.severity.toUpperCase()}** ${row.package}: ${row.advisory} (${row.range || "affected range not supplied"})${row.url ? " — " + row.url : ""}`)
    : ["No advisories were reported by pnpm audit."]),
  ""
].join("\n");
fs.writeFileSync(summaryPath, summary, "utf8");
console.log(summary);
