# Upstream integration plan

The product is implemented and released from this repository only: battlebuket-oss/BattleBuket-Codes.

## Components and boundaries

1. **VS Code OSS** is the editor/workbench foundation. Integrate it as the primary editing surface and preserve upstream notices, licensing, and branding requirements.
2. **Electron** is the desktop runtime used by the VS Code desktop architecture. Do not wrap a second Electron shell around an already Electron-based workbench.
3. **OpenAI Codex** is an execution engine behind the BattleBuket agent adapter. Use its supported CLI/App Server interface; do not claim the platform includes model access or provider billing.
4. **Anthropic Claude Code / Agent SDK** is a second execution engine behind the same adapter contract. Keep provider authentication, permissions, and usage visible in settings and diagnostics.

## Integration order

1. Pin upstream versions/commits and record license, notices, runtime requirements, and security advisories.
2. Establish the VS Code OSS workbench build and Electron packaging baseline.
3. Implement Codex adapter and verify event streaming, cancellation, workspace scoping, and authentication.
4. Implement Claude adapter against the same contract and run the same conformance tests.
5. Connect both adapters to the Engineering Director; add planning, delegation, review, retries, and audit history.
6. Add end-to-end tests, signed installers, update/rollback, crash recovery, and release gates.

## Non-negotiable safety boundaries

- Never execute agent-proposed shell commands without policy checks and the configured approval mode.
- Restrict file writes to the selected workspace unless the user explicitly authorizes otherwise.
- Keep provider credentials out of renderer processes, logs, source control, and crash reports.
- Treat agent output, repository files, terminal output, and tool results as untrusted data.
- A successful agent response is not a successful task until verification passes.
- Do not merge or redistribute upstream source until its current license and distribution terms have been reviewed.

## Current implementation status

The shared adapter contract and initial Director lifecycle are implemented in this repository. This does not yet mean the upstream workbench or provider runtimes have been vendored, built, or tested. Those integrations remain separate deliverables and must pass the release gates above.