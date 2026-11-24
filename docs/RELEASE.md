# Desktop release and signing

Production releases are tag-triggered. Push a version tag such as `v1.0.0` only after the source CI and installed-build smoke tests pass. The workflow builds Windows NSIS, macOS DMG, and Linux AppImage artifacts, then creates a **draft** GitHub release for review. It does not publish automatically.

## Required repository Actions secrets

Configure these in the repository's Settings → Secrets and variables → Actions. Never commit certificates, passwords, Apple credentials, or signing material.

### Windows
- `WINDOWS_CSC_LINK`: base64-encoded or URL-accessible signing certificate accepted by electron-builder.
- `WINDOWS_CSC_KEY_PASSWORD`: certificate password.

### macOS
- `MACOS_CSC_LINK`: Developer ID Application certificate accepted by electron-builder.
- `MACOS_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple Developer account email.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

Linux artifacts are not code-signed by this workflow. Add repository secrets only after confirming the certificate format and ownership.

## Release procedure

1. Confirm the default branch is green for audit, lint, typecheck, tests, build, CodeQL, and secret scanning.
2. Run the manual authenticated provider smoke workflow on the dedicated self-hosted runner and confirm Codex and Claude live read-only smoke tests pass with the intended local accounts.
3. Confirm the app's Code - OSS workbench is embedded, verify the bundled Monaco TypeScript worker can be created by the packaged renderer, and independently verify the native PTY terminal on clean Windows, macOS and Linux machines before calling the product production-ready.
4. Configure and validate the signing secrets above.
5. Push a version tag. The workflow must complete all platform builds and create a draft release.
6. Inspect installer signatures, macOS notarization/stapling, artifact hashes, installation, upgrade, rollback, uninstall, and launch behavior on clean machines. After two signed tags exist, run `.github/workflows/upgrade-rollback-smoke.yml` with the older and newer tags.
7. Publish the draft manually only after the release owner signs off.

A successful workflow run or draft release alone is not a production-readiness certification.