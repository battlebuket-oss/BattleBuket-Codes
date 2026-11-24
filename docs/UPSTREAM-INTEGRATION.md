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

## Implementation status

The BattleBuket repository now contains the initial desktop shell, shared provider-neutral agent contracts, an initial Engineering Director lifecycle, and lifecycle tests. The VS Code workbench, upstream runtime adapters, actual test execution, signing, packaging, and production hardening are not yet complete. This document is an integration plan, not a claim that those upstream components have already been installed or built.