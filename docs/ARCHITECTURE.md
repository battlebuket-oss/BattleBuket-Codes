# Architecture

## 1. Product shape

BattleBuket Codes is one desktop product with multiple internal execution providers. The user interacts with the BattleBuket interface and the Engineering Director. Provider identity is implementation detail except where disclosure, consent, billing, or legal notices require it.

## 2. System layers

### Desktop workbench
Use a VS Code OSS-derived workbench as the editor foundation. Keep the BattleBuket product identity, navigation, command center, task panel, agent activity, review queue, and settings consistent across the application. Avoid placing a second Electron wrapper around an existing Electron-based VS Code desktop build.

### Desktop runtime
Use Electron for desktop lifecycle, secure IPC, native menus, filesystem integration, and packaging. Renderer processes must not receive unrestricted Node.js access. Enable context isolation, sandboxing, and a strict preload bridge.

### Engineering Director
The Director is the control plane. It:
1. Converts a user request into an explicit task and acceptance criteria.
2. Builds a dependency graph and selects an execution strategy.
3. Assigns work to one or more provider adapters.
4. Creates isolated task workspaces or Git worktrees when concurrent edits are needed.
5. Streams progress and tool events into a normalized event model.
6. Reviews diffs, checks policy and permissions, and requests revisions.
7. Runs deterministic verification (tests, lint, typecheck, build, security checks).
8. Merges only after checks and required approvals pass.
9. Records decisions, failures, retries, and provenance.

The Director retains final authority. Providers cannot mark a task accepted or bypass the quality gate.

### Provider adapters
Define a stable internal provider contract. The first adapters are:
- OpenAI Codex: integrate through supported Codex CLI/App Server interfaces.
- Anthropic Claude: integrate through the supported Claude Agent SDK.

Do not couple core task orchestration to provider-specific event formats. Normalize events, tool calls, usage, errors, and cancellation into platform-owned types.

### Shared platform services
- Workspace and project registry.
- Git operations and worktree lifecycle.
- Permission broker and command approval.
- Secret/credential references (never plaintext in logs).
- Project indexing and context retrieval.
- Persistent task/event store.
- Test and build runner.
- Audit log and diagnostics.

## 3. Suggested monorepo layout

```text
apps/
  desktop/                 Electron main/preload + React renderer
packages/
  contracts/               Shared domain types and provider interfaces
  director/                Engineering Director orchestration
  providers/
    codex/                 Codex adapter
    claude/                Claude Agent SDK adapter
  workspace/               Project, Git, and worktree services
  permissions/             Policy and approval broker
  quality/                 Test/build/review gates
  storage/                 SQLite persistence and migrations
docs/
  ARCHITECTURE.md
  SECURITY.md
  ROADMAP.md
```

## 4. Execution lifecycle

```text
User request
    -> Director creates task + acceptance criteria
    -> Plan and dependency graph
    -> Provider adapter(s) execute in scoped worktrees
    -> Normalized events + live status
    -> Director review and revision loop
    -> Automated quality gates
    -> Human approval when policy requires it
    -> Merge / deliver / record audit trail
```

## 5. Concurrency and conflict control

Never allow two agents to make uncoordinated edits to the same working tree. Parallel work uses separate worktrees and explicit file ownership where practical. The Director reconciles changes, runs integration checks, and resolves or escalates conflicts.

## 6. Model and provider constraints

An SDK or CLI integration does not grant free model access. Users or the deployment must have valid provider credentials and comply with provider terms, quotas, and applicable billing. Provider implementations and SDKs must be reviewed at the pinned version before distribution.
