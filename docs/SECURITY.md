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

## Approval model

Classify actions as:
1. Read-only local inspection.
2. Workspace writes.
3. Local command execution.
4. Network access or dependency installation.
5. Destructive operations and external publication.

Start with conservative defaults. The user can grant scoped approvals; agents cannot grant permissions to themselves.

## Release requirements

Before a production release, complete threat modeling, dependency and license review, secret scanning, signing/notarization planning, update integrity checks, and an incident/rollback procedure.
