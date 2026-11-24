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
- Engineering Director task lifecycle and provider selection.
- Workspace file explorer, bounded text preview/editing, path boundary checks, and stale-write protection.
- Local JSONL task history with interrupted-run recovery, task titles, provider/risk, timestamps, changed-file count, and verification status. Prompts and model output are intentionally not persisted.
- Workspace command panel with a bounded one-command shell runner (120-second timeout, 1 MB output cap, reduced environment). This is not yet a persistent PTY terminal and does not support full-screen terminal applications.
- CI validation for audit, lint, typecheck, unit tests, build, and desktop bundles on Windows/macOS/Linux.
- A tag-triggered signed-release workflow that requires platform signing credentials and assembles a draft GitHub release.

Still not implemented or not verified:
- The full Code - OSS / VS Code workbench is not embedded in the BattleBuket desktop window. The current textarea editor is only a lightweight preview/editor and must not be represented as VS Code.
- A persistent PTY terminal with terminal resize, interactive TTY applications, and process/session management.
- Live provider end-to-end tests against authenticated Codex and Claude installations on supported desktop operating systems.
- Full task verification that runs project-specific tests/build/lint/security checks and makes task success depend on their results.
- Installer signing/notarization and release publication. The release workflow is configured, but it cannot produce a signed production release until repository signing secrets are configured and a tagged release build passes.
- Installed-app smoke tests, upgrade/uninstall tests, crash recovery, and real user acceptance testing.

A green source CI run is not proof of a production-ready desktop product. Production readiness requires the remaining items above to be implemented and verified on actual installed builds.