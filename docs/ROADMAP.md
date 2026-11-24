# Production roadmap

This roadmap distinguishes implemented foundations from incomplete systems. A checkbox means the feature exists in the repository and the stated test/acceptance evidence is available; it does not imply the overall product is production-ready.

## Phase 0 — Repository and engineering foundation
- [x] Initialize repository structure and document architecture/security boundaries.
- [x] Run CI install, lint, typecheck, tests, and build on Linux.
- [x] Add a high-severity dependency audit to CI.
- [x] Generate and commit a reproducible pnpm lockfile; require frozen installs.
- [x] Add CodeQL analysis, full-history secret scanning, and scheduled Dependabot updates.
- [ ] Add contribution rules, code owners, issue templates, release conventions, and dependency/license review automation.

## Phase 1 — Desktop shell
- [x] Establish a secure Electron main/preload/renderer boundary with context isolation, sandboxing, navigation blocking, and a restrictive CSP.
- [x] Add native project-folder selection and workspace-bounded directory browsing.
- [x] Add bounded text-file preview, atomic saves, stale-write detection, and path/symlink safety tests.
- [x] Add the task composer, provider selection, risk/permission selection, streamed task status, and cancellation controls.
- [x] Add Monaco Editor with bundled offline runtime and language workers, syntax-aware languages, minimap, per-file models, multi-file tabs, unsaved-draft preservation and Ctrl/Cmd+S.
- [x] Add bounded Quick Open filename/path search, project-wide bounded text search (Ctrl/Cmd+Shift+F), Monaco language diagnostics in a Problems panel, and a keyboard command palette for BattleBuket desktop actions (Ctrl/Cmd+Shift+P); add Ctrl/Cmd+S active-file save and Ctrl/Cmd+J terminal toggle. This is not the VS Code command registry or symbol/reference search.
- [x] Add a persistent recent-project list with canonical-path validation, missing-project cleanup, bounded retention and serialized writes; users can switch projects from the sidebar.
- [ ] Embed a tested Code - OSS workbench and complete workbench services, native extension host, symbol/reference search, workbench command registry, the full recent-workspace history integration and upstream notices. A bounded recent-project list is already present, but Monaco is only the editor component; the current Problems panel uses Monaco's language markers and Find in Files is a bounded plain-text search.
- [ ] Verify the native `node-pty` / xterm.js terminal implementation in draft PR #11: Electron ABI rebuild, interactive input/output, resize and process cleanup tests on Windows/macOS/Linux. The source implementation exists; the required cross-platform test evidence is not yet green.
- [x] Add a tag-triggered signed installer build and draft-release workflow with required Windows/macOS signing secrets.
- [ ] Configure real signing secrets and verify signed installers on Windows, macOS, and Linux; no production release has been published.

## Phase 2 — Platform contracts and persistence
- [x] Define initial task, agent, provider, event, verification, risk, and approval contracts.
- [ ] Complete task-plan, dependency, tool-call, audit-event, and recovery contracts.
- [x] Add local JSONL task-status history with non-prompt-derived task labels, interrupted-run recovery, provider/risk, timestamps, changed-file count, verification status, and bounded compaction; prompts and provider output are omitted.
- [ ] Replace the JSONL history with a transactional task/event store, schema migrations, corruption recovery, retention controls, searchable history, and structured redacted logs.
- [ ] Add workspace registry, Git status, and isolated worktree lifecycle.

## Phase 3 — Engineering Director
- [x] Accept one task, select a provider explicitly, enforce risk-based permissions, stream events, and support cancellation.
- [x] Gate a successful result on the current Git whitespace check.
- [ ] Implement prompt enhancement, acceptance-criteria generation, planning, dependency graphs, delegation, and scheduling.
- [x] Add a second read-only review pass after implementation using the same selected provider runtime; reviewer rejection prevents task completion. This is not an independent second model and can consume additional provider usage.
- [ ] Implement real specialist-agent delegation rather than role descriptions or simulated teams.
- [ ] Implement observation, review loops, replanning, retries, timeouts, checkpoints, and resumable tasks.
- [ ] Add multi-task isolation, worktree ownership, merge/conflict resolution, and human review of final diffs.
- [ ] Record task state and provider/tool provenance durably.

## Phase 4 — Provider integrations
- [x] Add an initial Codex CLI adapter with structured event ingestion, cancellation, and read-only/workspace-write modes.
- [x] Add an initial Claude Agent SDK adapter with cancellation, a restricted built-in tool allowlist, disabled project/user settings and MCP config, and bounded turns.
- [x] Add local runtime detection and explicit provider-unavailable states.
- [ ] Verify exact CLI/SDK versions, account authentication, supported models, license terms, platform packaging, and failure behavior.
- [ ] Add a credential setup/status flow; never log or persist provider secrets.
- [ ] Add quota/cost visibility, capability benchmarks, model selection, and deterministic integration tests on each supported OS.
- [ ] Add a proper permission broker for terminal, network, dependency installation, deletion, and other sensitive operations.

## Phase 5 — Quality and safety
- [x] Add workspace path/symlink, stale-save, binary-file, size-limit, and provider-permission tests.
- [x] Add a basic Git diff whitespace gate for Git workspaces.
- [x] Add CI dependency vulnerability auditing for high-severity findings.
- [x] Add CodeQL static analysis and full-history secret scanning.
- [x] Add consent-gated, fail-closed project quality runners for Node.js, Go, Rust, Python and .NET, including ecosystem dependency-security checks, bounded timeouts/output and approval of the exact commands. These commands still run with the user account permissions and are not a sandbox.
- [ ] Add actual diff review, static analysis, SAST, secret scanning, license checks, and dependency provenance.
- [ ] Add adversarial prompt-injection tests for repository content, project settings, MCP servers, and tool misuse.
- [x] Add opt-in live Codex/Claude read-only smoke tests and a manual self-hosted runner workflow. The tests require real sign-in and have not yet been executed on authenticated runners.
- [x] Add packaged-app smoke mode with Monaco worker and expected-version checks, plus release workflow steps for clean install, launch and uninstall on all three OS targets. These steps have not run yet.
- [x] Add manual cross-platform installer upgrade/rollback tests that verify a user-data marker survives baseline → candidate → rollback. The workflow requires two existing signed releases and has not yet run.
- [ ] Execute authenticated provider and signed-installer workflows; add workspace-write/escalation smoke tests, upgrade/rollback, crash-recovery and broader UI end-to-end tests.

## Phase 6 — Production release operations
- [ ] Add telemetry with opt-in/privacy controls, crash reporting, diagnostics export, and support logs.
- [x] Add the tag-triggered signed-release workflow, signing requirements, Windows/macOS signature checks, macOS notarization validation, and platform install/launch/uninstall smoke steps.
- [ ] Obtain signing certificates; configure secrets and execute a tagged signed release on real runners.
- [ ] Add a signed update channel, update integrity checks, staged rollout, rollback, and release provenance.
- [ ] Add backup/restore, data migration, offline/reconnect behavior, and a tested incident recovery plan.
- [x] Add initial privacy/data-handling documentation covering local storage, provider sharing, task history, and command execution.
- [ ] Complete legal review, user-facing privacy and retention controls, third-party/license inventory, support policy, and a release checklist.
- [ ] Verify clean install, upgrade, uninstall, data retention, and rollback on every supported OS.

## Release gate

Production readiness requires a reproducible, frozen dependency graph; secure credential handling; a real editor and terminal; isolated agent execution; durable task state and audit history; deterministic quality gates; no unresolved critical/high security issues; signed installers and update integrity; and end-to-end verification on every supported OS. The current repository does not meet this gate.
