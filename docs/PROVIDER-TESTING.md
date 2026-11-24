# Authenticated provider testing

The default CI suite deliberately does not sign in to Codex or Claude. It tests provider argument construction and adapter behavior without requiring accounts or spending model usage.

The live provider smoke tests are opt-in:

- BATTLEBUKET_REAL_PROVIDER_SMOKE=1 enables live execution.
- BATTLEBUKET_SMOKE_PROVIDERS=codex, claude, or codex,claude selects which adapters run.

For each selected provider, the live suite runs two conformance tests.

1. **Read-only request:** checks local runtime/authentication, asks the provider for an exact response marker, and verifies that the temporary workspace remains empty.
2. **Workspace-write boundary:** creates a temporary Git workspace, asks the provider to create exactly one named marker file, verifies the exact file content and changed-file list, and checks that a separate outside-workspace sentinel remains unchanged.

These tests make real provider requests. They may consume account quota or incur provider charges. Use a dedicated test machine or disposable OS account and accounts authorized for testing.

## Running locally

Install Node.js 22, pnpm 10, Git, the Codex CLI and/or Claude Agent SDK runtime. Authenticate each provider using its supported local sign-in process. Do not place credentials in the repository, commit them, or paste them into task prompts.

Then run:

\`\`\`sh
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=codex pnpm --filter @battlebuket/provider-adapters test
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=claude pnpm --filter @battlebuket/provider-adapters test
\`\`\`

For PowerShell:

\`\`\`powershell
$env:BATTLEBUKET_REAL_PROVIDER_SMOKE = "1"
$env:BATTLEBUKET_SMOKE_PROVIDERS = "codex,claude"
pnpm --filter @battlebuket/provider-adapters test
\`\`\`

## GitHub Actions

The manual workflow .github/workflows/provider-smoke.yml requires a dedicated self-hosted runner with both labels:

- self-hosted
- battlebuket-provider-smoke

The runner must have the selected provider runtimes installed and authenticated for the runner service account, plus Node.js 22, Git and the required sandbox support.

Start the workflow from Actions → Authenticated provider smoke tests and select which providers to exercise. Never attach this runner to untrusted pull-request workflows. It executes test prompts through authenticated local provider sessions.

The provider tests are not considered passed until the workflow has actually run on the authenticated runner and the logs show all selected read-only and workspace-write tests succeeded.

## Limitations

These tests cover simple read-only and single-file workspace-write behavior. They do not certify every model, permission escalation, long-running sessions, network isolation beyond the configured provider sandbox, desktop UI integration, OS release packages or future provider versions. Repeat them when the provider CLI/SDK, Electron, operating system or sandbox configuration changes.
