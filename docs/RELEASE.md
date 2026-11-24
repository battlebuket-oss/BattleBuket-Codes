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
2. Confirm Codex and Claude authenticated-runtime smoke tests have passed on real supported machines.
3. Confirm the app's Code - OSS workbench is embedded and independently verify the native PTY terminal on clean Windows, macOS and Linux machines before calling the product production-ready.
4. Configure and validate the signing secrets above.
5. Push a version tag. The workflow must complete all platform builds and create a draft release.
6. Inspect installer signatures, macOS notarization/stapling, artifact hashes, installation, upgrade, uninstall, and launch behavior on clean machines.
7. Publish the draft manually only after the release owner signs off.

A successful workflow run or draft release alone is not a production-readiness certification.