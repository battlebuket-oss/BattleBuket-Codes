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

The current preview includes the Electron desktop shell, secure context-isolated preload bridge, native project-folder selection, workspace-scoped directory browsing, bounded text-file previews, and editable text-file saves with stale-version protection. It also includes agent contracts, a virtual specialist workload planner, an Engineering Director foundation, and CI validation. This is not yet a production coding assistant: VS Code OSS, Codex and Claude execution adapters, terminal, editable code workflows, persistence, signed installers, and end-to-end release validation remain outstanding.

## Development status

See [the implementation roadmap](docs/ROADMAP.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md).

## Important integration and distribution note

Provider integrations must use supported interfaces and comply with the applicable licenses, SDK terms, trademarks, and distribution requirements. The application may keep provider internals out of the normal product UI, but it must not remove legally required notices or misrepresent ownership. Credentials must be supplied and stored securely; they must never be committed to this repository.
