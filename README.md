# BattleBuket Codes

**A desktop-first AI software engineering workspace from BattleBuket Studios.**

BattleBuket Codes brings a project workspace, local coding-engine integrations, and an Engineering Director into one desktop application. Codex and Claude run through their supported local runtimes and the user's own accounts; the application does not include model credits or provider credentials.

## Product principles

- One cohesive dark developer interface.
- The Engineering Director runs the selected provider, follows it with a separate read-only review pass using the same provider runtime, and requires verification before a task is reported as successful. The second pass can consume additional provider usage.
- Codex and Claude are execution providers behind the same application experience.
- Provider access uses explicit permission modes; unrestricted/full-access mode is disabled.
- Workspace content and terminal commands are untrusted input. Agent changes and command execution require user review.

## Current implementation

The repository currently includes:

- Electron desktop shell with a context-isolated preload bridge, navigation blocking and trusted-renderer IPC checks.
- Native project-folder selection, bounded workspace browsing, a Monaco code editor with language-aware highlighting, minimap and bundled language workers, multi-file tabs, unsaved-draft protection, Ctrl/Cmd+S saving, a Problems panel for Monaco language diagnostics, Quick Open filename search (Ctrl/Cmd+P), bounded project-wide text search (Ctrl/Cmd+Shift+F), a desktop command palette (Ctrl/Cmd+Shift+P), and integrated terminal toggle (Ctrl/Cmd+J), atomic saves, stale-write protection and path/symlink checks.
- Codex CLI adapter with version/login preflight, structured event streaming, cancellation, bounded runtime, read-only and workspace-write modes.
- Claude Agent SDK adapter with sandbox-required startup, restricted built-in tool allowlists, bounded turns and cancellation.
- Single-task Engineering Director lifecycle, explicit provider selection, risk-based approval and task status events.
- Local JSONL task history with interrupted-run recovery and size compaction. History stores status metadata and generic provider labels—not prompts, source files or model output.
- Native **PTY-based** interactive workspace terminal using node-pty and xterm.js, including input/output streaming, session lifecycle, terminal resize and bounded IO.
- Consent-gated project test/lint/typecheck/build script checks and supported npm/pnpm high-severity dependency audits, with bounded output and per-command timeouts.
- CI workflows for audit, lint, typecheck, unit tests, build, CodeQL, secret scanning and Windows/macOS/Linux desktop bundles.
- A tag-triggered signed-release workflow with platform signing checks, packaged Monaco-worker launch smoke mode, clean-install/uninstall steps and draft-release assembly; plus a manual two-tag upgrade/rollback smoke workflow.
- Opt-in live Codex/Claude adapter conformance tests and a manual self-hosted runner workflow.

## Important limitations — not a production release

The full Code - OSS / VS Code workbench is **not embedded**. The current editor uses Monaco (the code editor component from the VS Code ecosystem) with language workers, per-file models, multi-file tabs and unsaved-draft protection, but it is not the complete Code - OSS workbench. Workbench services, native extension host, symbol/reference search, extension APIs and upstream Code - OSS integration remain. Quick Open searches file names/paths and Find in Files searches bounded plain-text file contents; the lightweight command palette exposes BattleBuket desktop actions, not the complete VS Code command registry.

The PTY implementation is currently on the draft `feature/pty-terminal` pull request. It is not a verified production feature until the native Electron ABI and Windows/macOS/Linux workflow passes.

Project verification asks before executing project-defined scripts, but those scripts run with the user's operating-system permissions. They are not isolated in a dedicated execution sandbox. The current verification gate does not yet provide full SAST, independent diff review, license/provenance analysis or a complete adversarial prompt-injection test suite.

The live provider tests are opt-in and have not been run until an authenticated self-hosted runner is configured and the workflow succeeds. The signed installer workflow has not produced a production release; Windows and Apple signing credentials must be configured, and the actual tag build/install smoke tests must pass. Upgrade/rollback, broader crash recovery, auto-update integrity, and cross-version migration tests also remain.

**Do not describe the current repository as production-ready.** See [the verified implementation status](docs/UPSTREAM-INTEGRATION.md) and [the production roadmap](docs/ROADMAP.md).

## Local preview setup

Requirements: Node.js 22.12 or newer, pnpm 10.0.0, and Git.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For Codex tasks, install the Codex CLI, sign in using its supported local login flow, and use version 0.171.0 or newer. The app checks the CLI version and login state before enabling the provider.

For Claude tasks, the Claude Agent SDK runtime must be installed and authenticated on the machine, and its sandbox must be available. The app fails closed if required sandbox initialization fails.

## Provider conformance tests

Default CI does not sign in or spend model usage. Live provider tests are opt-in and require authenticated local runtimes. See [Provider testing](docs/PROVIDER-TESTING.md) for local commands and the dedicated self-hosted Actions runner instructions.

## Installer builds and releases

- `.github/workflows/desktop-installer.yml` builds signed installer previews. Windows/macOS signing secrets are required for those platforms.
- `.github/workflows/release.yml` runs the full source validation suite, builds platform installers on a version tag, validates signatures/notarization, performs installed-app smoke checks and creates a draft release.
- Required secrets and the release procedure are documented in [Release operations](docs/RELEASE.md).

Never commit signing certificates, passwords, provider credentials or API keys.

## Data handling

Agent prompts and project files read by an agent may be sent to the selected provider for processing. Project verification may execute repository-defined code after explicit approval. The integrated terminal runs with the user's OS account permissions. Task history remains local and omits prompts and model output. See [Privacy and data handling](docs/PRIVACY.md) before testing with non-public code or data.

## Architecture and security

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Upstream integration status](docs/UPSTREAM-INTEGRATION.md)
- [Production roadmap](docs/ROADMAP.md)
- [Privacy and data handling](docs/PRIVACY.md)
