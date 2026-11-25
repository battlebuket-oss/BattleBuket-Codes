import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("pnpm audit reporter keeps installed versions, dependency paths and upstream patched-version guidance", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const script = join(root, "scripts", "summarize-pnpm-audit.mjs");
  const temp = await mkdtemp(join(tmpdir(), "battlebuket-audit-summary-"));
  const input = join(temp, "pnpm-audit.json");
  const csv = join(temp, "audit.csv");
  const summary = join(temp, "audit.md");

  const report = {
    metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 1, info: 0 } },
    advisories: {
      "dompurify-advisory": {
        module_name: "dompurify",
        severity: "low",
        title: "DOMPurify test advisory",
        vulnerable_versions: ">=3.4.4 <=3.4.16",
        patched_versions: ">=3.4.17",
        recommendation: "Upgrade to version 3.4.17 or later",
        url: "https://example.invalid/dompurify",
        findings: [{ version: "3.4.15", paths: ["apps/desktop > @codingame/example@1.0.0 > dompurify@3.4.15"] }]
      },
      "minimatch-advisory": {
        module_name: "minimatch",
        severity: "moderate",
        title: "minimatch test advisory",
        vulnerable_versions: ">=7.0.0 <11.0.1",
        patched_versions: ">=11.0.1",
        recommendation: "Upgrade to version 11.0.1 or later",
        url: "https://example.invalid/minimatch",
        findings: [{ version: "10.2.6", paths: ["apps/desktop > tool@1.0.0 > minimatch@10.2.6"] }]
      }
    }
  };

  try {
    await writeFile(input, JSON.stringify(report), "utf8");
    const result = spawnSync(process.execPath, [script, input, csv, summary], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const csvText = await readFile(csv, "utf8");
    const summaryText = await readFile(summary, "utf8");

    assert.match(csvText, /"dompurify","low","transitive","apps\/desktop > @codingame\/example@1\.0\.0 > dompurify@3\.4\.15","3\.4\.15"/);
    assert.match(csvText, /">=3\.4\.17","DOMPurify test advisory","Upgrade to version 3\.4\.17 or later","3\.4\.17 or later","https:\/\/example\.invalid\/dompurify"/);
    assert.match(csvText, /"minimatch","moderate","transitive","apps\/desktop > tool@1\.0\.0 > minimatch@10\.2\.6","10\.2\.6"/);
    assert.match(csvText, /">=11\.0\.1","minimatch test advisory","Upgrade to version 11\.0\.1 or later","11\.0\.1 or later","https:\/\/example\.invalid\/minimatch"/);
    assert.match(summaryText, /Moderate: 1/);
    assert.match(summaryText, /Low: 1/);
    assert.match(summaryText, /Packages with an upstream remediation recommendation: 2/);
    assert.match(summaryText, /apps\/desktop > @codingame\/example@1\.0\.0 > dompurify@3\.4\.15/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
