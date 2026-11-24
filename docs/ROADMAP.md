# Production roadmap

This roadmap distinguishes committed foundation from work that is not yet implemented. No item is complete until code exists and its acceptance checks pass.

## Phase 0 — Repository and engineering foundation
- [x] Initialize repository structure and document architecture/security boundaries.
- [x] Add CI for install, lint, typecheck, tests, and build (latest passing commit recorded in GitHub Actions).
- [ ] Add contribution rules, code owners, issue templates, and release conventions.
- [ ] Pin dependency versions and establish automated dependency/license scanning.

## Phase 1 — Desktop shell
- [ ] Decide and pin the VS Code OSS upstream revision and required notices.
- [ ] Establish the branded dark workbench theme and BattleBuket navigation.
- [x] Build secure Electron main/preload/renderer boundaries (context isolation, sandbox, restricted preload, navigation blocking, CSP).
- [ ] Add recent projects, command palette, terminal, and diagnostics.\n- [x] Add native project-folder selection, workspace-bounded directory listing, and 1 MB read-only text previews (initial explorer only).
- [ ] Produce repeatable development builds for Windows, macOS, and Linux.

## Phase 2 — Platform contracts and persistence
- [ ] Define task, plan, agent, tool-call, event, approval, and verification contracts.
- [ ] Add SQLite schema, migrations, recovery, and structured logs.
- [ ] Add workspace registry, Git status, and isolated worktree lifecycle.
- [ ] Add provider-neutral streaming event protocol.

## Phase 3 — Engineering Director
- [ ] Implement task intake and acceptance-criteria generation.
- [ ] Implement planning, dependency graph, delegation, and scheduling.
- [ ] Implement provider selection, retries, cancellation, and timeout handling.
- [ ] Implement supervision, review loops, and conflict resolution.
- [ ] Implement audit trail and resumable tasks.

## Phase 4 — Provider integrations
- [ ] Verify Codex CLI/App Server interface, version, license, and distribution model.
- [ ] Implement Codex adapter with streaming, cancellation, and permission mediation.
- [ ] Verify Claude Agent SDK package terms, supported runtimes, and distribution requirements.
- [ ] Implement Claude adapter with streaming, cancellation, and permission mediation.
- [ ] Add provider health checks, credential setup, quotas, and clear failure states.
- [ ] Run capability and cost/latency benchmarks before enabling automatic routing.

## Phase 5 — Quality and safety
- [ ] Implement test/lint/typecheck/build runners and structured result reporting.
- [ ] Add diff review, static analysis, dependency audit, and secret scanning.
- [ ] Add human approval gates and safe merge workflow.
- [ ] Add adversarial tests for prompt injection from repository content and tool misuse.

## Phase 6 — Production readiness
- [ ] Add telemetry with privacy controls, crash reporting, and diagnostics export.
- [ ] Add signed installers, code signing/notarization, auto-update, and rollback.
- [ ] Add backup/restore, data migration, and offline/reconnect behavior.
- [ ] Add end-to-end tests on supported operating systems.
- [ ] Publish support policy, privacy disclosures, third-party notices, and release checklist.

## Release gate

Production-ready means clean installation, secure credential handling, reproducible builds, tested update/rollback, no unresolved critical/high security issues, provider failure recovery, and end-to-end verification on every supported OS.
