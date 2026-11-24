# Production roadmap

This roadmap distinguishes implemented foundations from incomplete systems. A checkbox means the feature exists in the repository and the stated test/acceptance evidence is available; it does not imply the overall product is production-ready.

## Phase 0 — Repository and engineering foundation
- [x] Initialize repository structure and document architecture/security boundaries.
- [x] Run CI install, lint, typecheck, tests, and build on Linux.
- [x] Add a high-severity dependency audit to CI.
- [ ] Generate and commit a reproducible pnpm lockfile; require frozen installs.
- [ ] Add contribution rules, code owners, issue templates, release conventions, secret scanning, and dependency/license review automation.

## Phase 1 — Desktop shell
- [x] Establish a secure Electron main/preload/renderer boundary with context isolation, sandboxing, navigation blocking, and a restrictive CSP.
- [x] Add native project-folder selection and workspace-bounded directory browsing.
- [x] Add bounded text-file preview, atomic saves, stale-write detection, and path/symlink safety tests.
- [x] Add the task composer, provider selection, risk/permission selection, streamed task status, and cancellation controls.
- [ ] Integrate a supported VS Code OSS workbench revision with all upstream notices and reproducible build instructions.
- [ ] Add a true code editor experience, tabs, diagnostics, command palette, project search, and recent projects.
- [ ] Add an integrated terminal with a permission broker and PTY lifecycle management.
- [ ] Run and verify installers on Windows, macOS, and Linux; the current workflow only defines unsigned preview builds.

## Phase 2 — Platform contracts and persistence
- [x] Define initial task, agent, provider, event, verification, risk, and approval contracts.
- [ ] Complete task-plan, dependency, tool-call, audit-event, and recovery contracts.
- [ ] Add durable local storage, schema migrations, corruption recovery, retention controls, and structured redacted logs.
- [ ] Add workspace registry, Git status, and isolated worktree lifecycle.

## Phase 3 — Engineering Director
- [x] Accept one task, select a provider explicitly, enforce risk-based permissions, stream events, and support cancellation.
- [x] Gate a successful result on the current Git whitespace check.
- [ ] Implement prompt enhancement, acceptance-criteria generation, planning, dependency graphs, delegation, and scheduling.
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
- [ ] Add project-aware test/lint/typecheck/build runners in a sandbox, with structured outputs and timeouts.
- [ ] Add actual diff review, static analysis, SAST, secret scanning, license checks, and dependency provenance.
- [ ] Add adversarial prompt-injection tests for repository content, project settings, MCP servers, and tool misuse.
- [ ] Add end-to-end tests for the whole app, real provider sessions, approval/cancellation, file recovery, and corrupted workspaces.

## Phase 6 — Production release operations
- [ ] Add telemetry with opt-in/privacy controls, crash reporting, diagnostics export, and support logs.
- [ ] Obtain signing certificates; configure Windows code signing and macOS Developer ID signing/notarization.
- [ ] Add a signed update channel, update integrity checks, staged rollout, rollback, and release provenance.
- [ ] Add backup/restore, data migration, offline/reconnect behavior, and a tested incident recovery plan.
- [ ] Publish privacy disclosures, provider/third-party notices, license inventory, support policy, and a release checklist.
- [ ] Verify clean install, upgrade, uninstall, data retention, and rollback on every supported OS.

## Release gate

Production readiness requires a reproducible, frozen dependency graph; secure credential handling; a real editor and terminal; isolated agent execution; durable task state and audit history; deterministic quality gates; no unresolved critical/high security issues; signed installers and update integrity; and end-to-end verification on every supported OS. The current repository does not meet this gate.
