# Authenticated provider testing

The default CI suite deliberately does not use live provider accounts or consume model quota. It tests adapter argument construction, cancellation and local validation only.

The opt-in live suite uses two conformance scenarios for each selected provider:

1. **Read-only:** verifies the provider is authenticated, returns the exact smoke marker, and leaves a temporary workspace empty.
2. **Workspace-write boundary:** asks the provider to create exactly one marker file in a disposable Git workspace and verifies its contents, changed-file list, and an outside-workspace sentinel.

These checks are intentionally small. They do not prove every prompt-injection scenario, model/version, provider permission escalation, long-running session, desktop UI interaction or OS escape path.

## GitHub Actions

Run the manual workflow `.github/workflows/provider-smoke.yml` from Actions → Authenticated provider smoke tests.

Configure these repository Actions secrets first (Settings → Secrets and variables → Actions):

- `OPENAI_API_KEY` — required when Codex is selected.
- `ANTHROPIC_API_KEY` — required when Claude is selected.

The workflow runs on a disposable hosted Linux runner. It installs Bubblewrap and the Codex CLI when requested, uses the Claude Agent SDK from the locked workspace dependency, and runs the real read-only and workspace-write tests. It fails before test execution when a selected provider's credential is missing. Do not paste API keys into this repository, issue comments, task prompts or chat.

Real tests may consume provider quota or incur charges. Use dedicated, low-privilege test credentials and rotate them according to your organization's secret-management policy.

The tests are considered passed only after a manually dispatched run completes successfully and the logs show all four selected tests (two per provider) passed. A skipped test is not a pass.

## Local execution

Install Node.js 22, pnpm 10, Git, the Codex CLI and/or the Claude Agent SDK runtime, then authenticate the selected provider using its supported local mechanism.

Bash:

```sh
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=codex pnpm --filter @battlebuket/provider-adapters test
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=claude pnpm --filter @battlebuket/provider-adapters test
```

PowerShell:

```powershell
$env:BATTLEBUKET_REAL_PROVIDER_SMOKE = "1"
$env:BATTLEBUKET_SMOKE_PROVIDERS = "codex,claude"
pnpm --filter @battlebuket/provider-adapters test
```

## Current limitations

- The write test verifies one workspace file and one outside sentinel; it is not a complete filesystem attack suite.
- Codex and Claude enforce their own provider sandbox policies; the app's local project verification sandbox is a separate boundary.
- Live API-key tests do not certify user OAuth login flows, credential refresh UX, billing or provider outages.
- Repeat these tests when the provider CLI/SDK, model, permission flags, Electron, operating system or sandbox configuration changes.
