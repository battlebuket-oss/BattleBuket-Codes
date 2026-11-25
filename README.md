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
- Native project-folder selection with a validated, persistent recent-project list (last 10), bounded workspace browsing, a Monaco code editor with language-aware highlighting, minimap and bundled language workers, multi-file tabs, unsaved-draft protection, Ctrl/Cmd+S saving, a Problems panel for Monaco language diagnostics, Quick Open filename search (Ctrl/Cmd+P), bounded project-wide text search (Ctrl/Cmd+Shift+F), a desktop command palette (Ctrl/Cmd+Shift+P), and integrated terminal toggle (Ctrl/Cmd+J), atomic saves, stale-write protection and path/symlink checks.
- Codex CLI adapter with version/login preflight, structured event streaming, cancellation, bounded runtime, read-only and workspace-write modes.
- Claude Agent SDK adapter with sandbox-required startup, restricted built-in tool allowlists, bounded turns and cancellation.
- Single-task Engineering Director lifecycle, explicit provider selection, risk-based approval and task status events.
- Local JSONL task history with interrupted-run recovery and size compaction. History stores status metadata and generic provider labels—not prompts, source files or model output.
- Native **PTY-based** interactive workspace terminal using node-pty and xterm.js, including input/output streaming, session lifecycle, terminal resize and bounded IO.
- Consent-gated project-aware test/lint/typecheck/build and dependency-security checks for Node.js, Go, Rust, Python and .NET, with bounded output, per-command timeouts and fail-closed handling for unsupported projects. Linux uses Bubblewrap and macOS uses Seatbelt to isolate project checks from host writes/network; Windows project commands fail closed until an AppContainer broker is available.
- CI workflows for audit, lint, typecheck, unit tests, build, CodeQL, secret scanning and Windows/macOS/Linux desktop bundles.
- A tag-triggered signed-release workflow with platform signing checks, packaged Monaco-worker launch smoke mode, clean-install/uninstall steps and draft-release assembly; plus a manual two-tag upgrade/rollback smoke workflow.
- Opt-in live Codex/Claude read-only and workspace-write boundary tests, plus a manual self-hosted runner workflow.

## Important limitations — not a production release

The desktop now embeds the VS Code workbench service through the MIT-licensed Monaco VS Code API packages when a project is open, with a scoped workspace filesystem provider, built-in explorer/search/quick access, language feature extensions, Problems/markers and a native PTY terminal bridge. This is an embedded VS Code web workbench integration; it does not vendor the full Code - OSS desktop source or ship the entire Microsoft Marketplace extension catalog. The packaged workbench/extension-host/filesystem/terminal smoke suite has passed on Windows, macOS and Linux for the current feature branch head. This is automated acceptance evidence, not a signed-release or full Code-OSS certification.

The PTY implementation is currently on the draft `feature/pty-terminal` pull request. Native Electron ABI rebuilds and packaged workbench/PTY smoke have passed on Windows, macOS and Linux in GitHub Actions.

Project verification supports the currently documented Node.js, Go, Rust, Python and .NET command mappings; missing security scanner tools or unsupported project manifests fail verification rather than being marked as passed. It asks before executing project-defined scripts, but those scripts run with the user's operating-system permissions. They are not isolated in a dedicated execution sandbox. The current verification gate does not yet provide full SAST, independent diff review, license/provenance analysis or a complete adversarial prompt-injection test suite.

The live provider tests are opt-in and still require the repository's `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` Actions secrets plus a successful manual workflow run. The signed installer workflow has not produced a production release; Windows and Apple signing credentials must be configured and a tagged signed build must pass. The upgrade/rollback workflow exists but needs two signed releases and has not run. Broader crash recovery, auto-update integrity, and cross-version migration tests also remain.

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

See [Project verification and quality gates](docs/QUALITY-GATES.md) for supported language toolchains, security scanner prerequisites and known limits.

## Architecture and security

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Upstream integration status](docs/UPSTREAM-INTEGRATION.md)
- [Production roadmap](docs/ROADMAP.md)
- [Privacy and data handling](docs/PRIVACY.md)
