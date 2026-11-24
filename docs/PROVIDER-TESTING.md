# Authenticated provider testing

The default CI suite deliberately does not sign in to Codex or Claude. It tests provider argument construction and runtime adapter logic without requiring accounts or spending model usage.

The live provider smoke tests are opt-in:

- `BATTLEBUKET_REAL_PROVIDER_SMOKE=1` enables live execution.
- `BATTLEBUKET_SMOKE_PROVIDERS=codex`, `claude`, or `codex,claude` selects which adapters run.

Each selected provider is tested in a disposable Git workspace:
1. Read-only task: asks the provider to inspect a README and verifies no workspace files were changed.
2. Workspace-write task: asks the provider to create exactly one marker file, verifies its contents, and verifies an adjacent sentinel outside the workspace remains unchanged.

## Running locally

Use a dedicated test machine or disposable OS account. Install Node.js 22, pnpm 10, Git, the Codex CLI and/or Claude Agent SDK runtime. Authenticate each provider using its supported local sign-in process. Do not place credentials in the repository, commit them, or paste them into task prompts.

Then run:

```sh
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=codex pnpm --filter @battlebuket/provider-adapters test
BATTLEBUKET_REAL_PROVIDER_SMOKE=1 BATTLEBUKET_SMOKE_PROVIDERS=claude pnpm --filter @battlebuket/provider-adapters test
```

For PowerShell:

```powershell
$env:BATTLEBUKET_REAL_PROVIDER_SMOKE = "1"
$env:BATTLEBUKET_SMOKE_PROVIDERS = "codex,claude"
pnpm --filter @battlebuket/provider-adapters test
```

These are real provider requests. They may consume account quota or incur provider charges. Run them only with accounts authorized for testing.

## GitHub Actions

The manual workflow `.github/workflows/provider-smoke.yml` requires a dedicated self-hosted runner with both labels:

- `self-hosted`
- `battlebuket-provider-smoke`

The runner must have both provider runtimes installed and authenticated for the runner service account, plus Node.js 22, Git and the required sandbox support. Start the workflow from Actions → Authenticated provider smoke tests and select which providers to exercise.

Never attach this runner to untrusted pull-request workflows. It executes test prompts through authenticated local provider sessions. The smoke tests are not considered passed until the workflow has actually been run on the authenticated runner and the logs show all selected live tests succeeded.

## Limitations

These tests exercise the adapter CLI/SDK interfaces and simple workspace file boundaries. They do not certify every model, approval escalation, long-running task, network policy, desktop UI flow, OS release package, or future provider version. Repeat them when the provider CLI/SDK, Electron, operating system, or sandbox configuration changes.
