#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-appimage-smoke.sh <AppImage> [application arguments...]" >&2
  exit 2
fi

appimage="$(realpath "$1")"
shift
if [[ ! -f "$appimage" || ! -x "$appimage" ]]; then
  echo "AppImage is missing or not executable: $appimage" >&2
  exit 2
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/battlebuket-appimage-smoke.XXXXXX")"
cleanup() {
  sudo chown -R "$(id -u):$(id -g)" "$workdir" 2>/dev/null || true
  rm -rf "$workdir"
}
trap cleanup EXIT INT TERM

(
  cd "$workdir"
  "$appimage" --appimage-extract >/dev/null
)

root="$workdir/squashfs-root"
if [[ ! -x "$root/AppRun" ]]; then
  echo "Extracted AppImage does not contain an executable AppRun." >&2
  exit 1
fi

sandbox_helper="$(find "$root" -type f -name chrome-sandbox -print -quit)"
if [[ -z "$sandbox_helper" ]]; then
  echo "Extracted AppImage does not contain Chromium's chrome-sandbox helper." >&2
  exit 1
fi

sudo chown root:root "$sandbox_helper"
sudo chmod 4755 "$sandbox_helper"
if [[ "$(stat -c '%U:%a' "$sandbox_helper")" != "root:4755" ]]; then
  echo "Chromium SUID sandbox helper is not root-owned mode 4755." >&2
  exit 1
fi

if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "dbus-run-session is required; install dbus-daemon on this Linux runner." >&2
  exit 1
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "xvfb-run is required; install xvfb on this Linux runner." >&2
  exit 1
fi

env -u DBUS_SESSION_BUS_ADDRESS dbus-run-session -- xvfb-run -a "$root/AppRun" "$@"
