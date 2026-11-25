# Security baseline

## Non-negotiable defaults

- No secrets, API keys, OAuth tokens, or private keys in source control, logs, crash reports, or task transcripts.
- Renderer has no direct Node.js or unrestricted filesystem/process access.
- Electron context isolation and sandboxing remain enabled; expose only narrow, validated preload APIs.
- Shell, network, file deletion, credential access, and Git push operations are permissioned capabilities.
- Destructive or externally visible actions require explicit approval according to policy.
- Every agent tool call records actor/provider, task, workspace, timestamp, requested capability, decision, and outcome while redacting secrets.
- Provider processes run with least privilege and a task-scoped working directory.
- Cancellation must terminate or safely detach child processes and mark task state accurately.
- Untrusted repository content is data, never an instruction to override system policy.


## Workbench renderer content security policy

The embedded VS Code workbench uses bundled browser-language extensions. The built-in TypeScript language extension dynamically evaluates bundled extension code during activation, and the bundled schema services use embedded `data:` JSON resources. The packaged renderer therefore allows `'unsafe-eval'` for its self-hosted script runtime and `data:` only in `connect-src`. Inline scripts remain blocked, remote script/style/font origins remain blocked, and arbitrary remote network origins are not permitted.

**Security trade-off:** `'unsafe-eval'` weakens CSP's protection against script injection in the renderer. Keep the extension set pinned and bundled, do not render untrusted HTML as executable content, and preserve Electron sandboxing, context isolation, `nodeIntegration: false`, and strict validation on every preload IPC handler. Do not add remote extension marketplaces or unreviewed extensions without a separate extension-sandbox and security review.

## Approval model

Classify actions as:
1. Read-only local inspection.
2. Workspace writes.
3. Local command execution.
4. Network access or dependency installation.
5. Destructive operations and external publication.

Start with conservative defaults. The user can grant scoped approvals; agents cannot grant permissions to themselves.


## Software bill of materials and license inventory

The `.github/workflows/security-inventory.yml` workflow generates an SPDX JSON SBOM using a pinned Syft release and creates a CSV inventory of package versions and declared/concluded SPDX license expressions. It publishes those files and a manual-review summary as workflow artifacts. Components without a usable license expression are explicitly listed for review.

The generated inventory is evidence to support a release review, not a legal opinion or automated license-compatibility approval. Review direct and transitive obligations, notices, copyleft/reciprocal terms, dual-licensing conditions, vendored code and distribution obligations before publishing installers.

## Release requirements

Before a production release, complete threat modeling, dependency and license review, secret scanning, signing/notarization planning, update integrity checks, and an incident/rollback procedure.
