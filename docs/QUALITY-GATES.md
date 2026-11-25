# Project verification and quality gates

BattleBuket Codes does not treat a successful provider response or a clean Git whitespace check as proof that a project change is verified. The Engineering Director discovers supported project checks, asks the user before running repository-defined commands, and fails the verification gate when no supported project check can be identified or an approved check fails.

## Supported project types

| Project type | Test | Static analysis / lint | Type check | Build | Dependency security |
|---|---|---|---|---|---|
| Node.js | Root test script | Root lint script | Root typecheck script | Root build script | pnpm audit --audit-level high or npm audit --audit-level=high when the matching lockfile exists |
| Go | go test ./... | go vet ./... | Covered by Go compilation | go build ./... | govulncheck ./... |
| Rust | cargo test | cargo clippy --all-targets --all-features -- -D warnings | cargo check --all-targets | cargo build --all-targets | cargo audit |
| Python | python -m pytest -q when test configuration or a test directory is detected | python -m ruff check . when [tool.ruff] is configured | python -m mypy . when [tool.mypy] is configured | python -m build when [build-system] is configured | python -m pip_audit -r requirements.txt when requirements.txt exists |
| .NET | dotnet test | dotnet format --verify-no-changes | Covered by the .NET compiler during build | dotnet build | dotnet list package --vulnerable --include-transitive |

Only commands detected from a supported root manifest/configuration are offered. A Python project must declare the relevant pytest/Ruff/mypy/build configuration to have those checks included. Python dependency auditing is currently wired to a root requirements.txt file. Other project layouts and languages remain unsupported by the automatic quality runner until a deterministic command mapping and tests are added.

## Security scanner prerequisites

The application does not silently install project tools. Depending on the project, the environment must already have the relevant scanner available:

- Go: govulncheck
- Rust: the cargo-audit Cargo subcommand (cargo audit)
- Python: the pip-audit Python module
- .NET: a .NET SDK that supports dotnet list package --vulnerable
- Node.js: pnpm or npm matching the selected lockfile

If the scanner is missing, the check fails and the output identifies the failed command. A scanner missing from the current machine is not reported as a pass.

## Execution and consent

- The complete command list is shown before execution; the user must explicitly approve it.
- Each command has a five-minute timeout and a two-megabyte captured-output limit.
- The child process receives a reduced environment, but runs as the current operating-system user. Project-defined commands can execute arbitrary code and can access the network. This is not a sandbox.
- The user can cancel the task; the abort signal is propagated to the quality command and both provider adapters.
- Git staged and unstaged whitespace checks remain an additional check. They are never substituted for missing project tests, static analysis, build or dependency scanning.
- All checks that are detected and approved must pass for the Director's verification phase to pass.

## Known limitations

This is an initial language-aware quality runner, not a complete SAST or supply-chain security product. It does not provide general-purpose secret scanning of a user's project, license/provenance analysis, container scanning, IaC scanning, fuzzing, sanitizer runs, coverage thresholds, or a formal sandbox for running project scripts. It does not automatically discover nested monorepo packages or custom build orchestrators. Add and test ecosystem-specific command mappings before marking additional project types as supported.
