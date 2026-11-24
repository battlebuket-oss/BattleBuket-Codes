# Privacy and data handling

This document describes the data flows implemented by the current BattleBuket Codes desktop preview. It is not legal advice and is not a substitute for a reviewed privacy notice before public distribution.

## Local data

- Project browsing and text-file editing use the folder selected by the user.
- The local task-history file is stored in Electron's per-user application data directory. It stores a task ID, generic provider label, risk level, start/finish times, status, changed-file count and verification result. It does not store task prompts, source contents or model output.
- Terminal input and terminal output are streamed between the renderer and a local shell process. The current shell runs with the permissions of the operating-system user.
- No product analytics or telemetry service is currently configured.

## Provider data sharing

When a task is submitted, the prompt and any project files or surrounding context the selected agent reads may be sent to the selected provider for processing. Provider authentication and billing are handled by the user's locally installed provider runtime/account. BattleBuket Codes does not include model access, API credits or provider credentials.

Do not submit passwords, access tokens, private keys, regulated personal data, confidential source code, or other information unless the user is authorized to share it with that provider. The provider's own privacy, retention, training, account and billing terms apply.

## Commands and verification

- Codex and Claude are restricted to the adapter's configured permission modes. Provider sandbox behavior is provider-specific and must not be treated as a guarantee against every host escape.
- Project verification may execute scripts defined by the selected project's package manifest. These scripts can run arbitrary code and may access the network using the user's account. The app asks for explicit approval before running them; they run with a reduced environment, bounded output and a per-command timeout, but are not currently isolated in a dedicated sandbox.
- The integrated shell is a persistent pipe-based shell, not a PTY. Shell commands run with the user's operating-system permissions. Run only commands from sources the user trusts.

## Diagnostics and retention

Crash reporting, automatic diagnostics upload, remote backups and telemetry are not currently enabled. The app does not upload task history. Provider runtimes may maintain their own local caches or account-side records under their own terms.

Task history is compacted to retain the most recent 50 tasks when its local file grows beyond the configured size limit. Users can remove this local application data through the operating system's application-data controls after closing the app. A user-facing retention and deletion screen is not yet implemented.

## Before public release

Have this document reviewed for the intended markets and operating systems. Add a user-facing privacy notice, settings to control any future telemetry/crash reporting, retention/deletion controls, support contact, processor list and legally reviewed disclosures before public distribution.
