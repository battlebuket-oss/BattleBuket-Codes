# BattleBuket Codes

**A unified, desktop-first AI software engineering platform.**

BattleBuket Codes brings a branded developer workspace together with multiple coding engines coordinated by the **Engineering Director**. Users work in one application; engine selection, delegation, execution, review, and verification happen behind that unified experience.

## Product principles

- One cohesive, dark, keyboard-first developer interface.
- The Engineering Director owns task planning, delegation, execution tracking, review, and acceptance.
- Codex and Claude are internal execution providers, not separate user-facing products.
- VS Code OSS is the intended editor/workbench foundation; Electron is its desktop runtime, not a second shell to wrap around it.
- Agents operate with explicit permissions, scoped workspaces, and auditable tool execution.
- A task is complete only after required checks and acceptance criteria pass—not because an agent says it is done.

## Planned architecture

| Layer | Responsibility |
|---|---|
| Desktop workbench | Branded VS Code OSS-based editor, activity surfaces, terminal, project explorer |
| Desktop runtime | Electron-based desktop packaging and OS integration |
| Engineering Director | Task graph, routing, context assembly, delegation, supervision, review, recovery |
| Codex provider | OpenAI Codex CLI/App Server integration through a provider adapter |
| Claude provider | Anthropic Claude Agent SDK integration through a provider adapter |
| Shared services | Workspace isolation, Git/worktrees, permissions, project memory, event log |
| Quality gate | Build/test/lint/security checks and human approval gates |

## Repository status

The current engineering preview includes the Electron desktop shell, secure context-isolated preload bridge, native project selection, bounded workspace file browsing and atomic text-file saves, a task composer, and a single-task Engineering Director pipeline connected to locally installed Codex CLI and the Claude Agent SDK. Provider events stream to the UI; workspace-write tasks require explicit approval; read-only and write modes use separate tool policies. CI runs lint/typecheck/tests/build and a high-severity dependency audit.

This is **not a production release**. The VS Code OSS workbench and integrated terminal are not implemented. The Director does not yet provide real multi-agent delegation, planning/dependency graphs, isolated Git worktrees, a durable event/recovery database, resumable execution, or conflict recovery. It currently stores only minimal task-status metadata locally; prompts and model output are not persisted. Verification is limited to a Git whitespace check; project tests, builds, security scans, and end-to-end acceptance are not run for each agent task. The cross-platform installer workflow is configured but unsigned and not yet verified on all operating systems. Code signing/notarization, secure credential setup, auto-update/rollback, full privacy and license review, and operational support remain release blockers.

## Development status

See [the implementation roadmap](docs/ROADMAP.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md).

## Important integration and distribution note

Provider integrations must use supported interfaces and comply with the applicable licenses, SDK terms, trademarks, and distribution requirements. The application may keep provider internals out of the normal product UI, but it must not remove legally required notices or misrepresent ownership. Credentials must be supplied and stored securely; they must never be committed to this repository.
