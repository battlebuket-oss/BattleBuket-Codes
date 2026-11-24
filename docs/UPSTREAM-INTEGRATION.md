# Upstream integration plan

All first-party product changes and commits belong in battlebuket-oss/BattleBuket-Codes. Upstream repositories are integration dependencies, not destinations for our work.

## Selected upstream components

| Component | Upstream | Integration decision |
|---|---|---|
| Editor/workbench | https://github.com/microsoft/vscode | Use Code - OSS as the editor/workbench base; pin a tested revision and preserve MIT notices and third-party notices. |
| Desktop runtime | https://github.com/electron/electron | Electron is the runtime already used by the VS Code desktop architecture. Do not create a second nested Electron shell. Pin a compatible runtime through the workbench build. |
| Coding agent | https://github.com/openai/codex | Integrate the supported Codex CLI/App Server protocol behind the BattleBuket adapter. The upstream repository is Apache-2.0; model access and account/API billing remain subject to OpenAI terms. |
| Coding agent | https://github.com/anthropics/claude-code | Integrate Claude Code as a separately installed/provider-managed runtime or through the supported Claude Agent SDK. Do not vendor or redistribute Claude Code source: its repository LICENSE.md states Anthropic copyright and that use is subject to Anthropic Commercial Terms. |

## Integration sequence

1. Record immutable upstream revisions, runtime versions, licenses, notices, and security advisories.
2. Establish a reproducible Code - OSS workbench build with its Electron runtime and BattleBuket branding.
3. Add a Codex adapter using the supported machine interface; test authentication, streaming, cancellation, workspace boundaries, and approval modes.
4. Add a Claude adapter using the supported installed runtime/SDK; test the same adapter conformance suite and comply with Anthropic commercial terms.
5. Connect both adapters to the Engineering Director; implement task planning, delegation, independent review, retry/recovery, and durable audit history.
6. Add end-to-end tests, signed installers, update/rollback, crash recovery, and release gates.

## Security and release gates

- Never execute agent-proposed shell commands without policy checks and the configured approval mode.
- Restrict writes to the selected workspace unless the user explicitly authorizes otherwise.
- Keep provider credentials out of renderer processes, logs, source control, and crash reports.
- Treat agent output, repository files, terminal output, and tool results as untrusted data.
- A successful agent response is not a successful task until verification passes.
- Do not redistribute upstream code or bundled runtimes unless the relevant license and provider terms explicitly permit it.
- No provider credentials or paid model access are included with the application.

## Implementation status (verified against the current repository)

Implemented in BattleBuket-Codes:
- Electron desktop shell with isolated preload bridge and trusted top-level renderer IPC checks.
- Codex CLI adapter with version/authentication preflight, JSON event parsing, cancellation, bounded runtime, read-only/workspace-write modes, and no full-access mode.
- Claude Agent SDK adapter with explicit tool allowlists, sandbox-required execution, cancellation, bounded runtime, and no full-access mode. Claude SDK/runtime terms still apply; this package does not grant provider access or redistribute Claude Code source.
- Engineering Director task lifecycle, provider selection, and a second read-only review pass using the same provider runtime. Reviewer rejection fails the task gate; the second pass may consume additional usage.
- Workspace file explorer, bounded text preview/editing, path boundary checks, and stale-write protection.
- Local JSONL task history with interrupted-run recovery, task titles, provider/risk, timestamps, changed-file count, and verification status. Prompts and model output are intentionally not persisted.
- Native `node-pty` shell session with xterm.js rendering, streamed input/output, terminal resize, lifecycle cleanup and bounded IO. Implemented on draft PR #11; native ABI builds and PTY runtime tests on Windows/macOS/Linux are still pending.
- Consent-gated project script verification for test/lint/typecheck/build and high-severity pnpm/npm lockfile audits, with five-minute per-command timeout and bounded output. These scripts are arbitrary project code, run under the user's OS account, and are not a security sandbox.
- Durable local JSONL task status history with interrupted-run recovery and size compaction that preserves the latest 50 tasks. This is not a transactional event database.
- Opt-in live Codex/Claude conformance tests for read-only and workspace-write flows, plus a manual self-hosted runner workflow. The live tests have not yet been run on an authenticated provider runner.
- CI validation for audit, lint, typecheck, unit tests, build, CodeQL, secret scanning, and desktop bundles on Windows/macOS/Linux.
- A tag-triggered release workflow that requires Windows/macOS signing secrets, builds platform installers, checks signatures/notarization, performs installed-app launch smoke checks, and assembles a draft GitHub release. No tagged production release has run or been published.

Still not implemented or not verified:
- The full Code - OSS / VS Code workbench is not embedded in the BattleBuket desktop window. The current editor is Monaco with language workers, multi-file tabs, unsaved-draft protection, Quick Open filename search (Ctrl/Cmd+P), a small BattleBuket command palette (Ctrl/Cmd+Shift+P), active-file save (Ctrl/Cmd+S) and terminal toggle (Ctrl/Cmd+J); Monaco is an editor component, not the full VS Code workbench or extension host. The current palette is not the full VS Code command registry.
- Native PTY implementation is present in draft PR #11, awaiting CI verification against Electron's ABI on all supported operating systems.
- Execution of the live provider smoke workflow on authenticated Codex and Claude runners, plus extended OS/model/version coverage. A harness exists but has not yet been run against live accounts.
- Sandboxed project verification and broader quality gates (SAST, secret scanning, license/provenance checks). Current project scripts require approval and run with user permissions; supported lockfile audits are available, but there is no execution sandbox.
- Installer signing/notarization and release publication. The release workflow is configured, but it cannot produce a signed production release until repository signing secrets are configured and a tagged release build passes.
- Actual signed installer workflow execution and artifact verification, upgrade/rollback tests, crash recovery, and real user acceptance testing. The tag workflow now defines clean-install/launch/uninstall smoke steps, but those steps have not run.

A green source CI run is not proof of a production-ready desktop product. Production readiness requires the remaining items above to be implemented and verified on actual installed builds.