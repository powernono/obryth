#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$root/scripts/cargo.sh" build --release --manifest-path "$root/vendor/prospero/Cargo.toml" -p prosperod-rs
mkdir -p "$root/apps/desktop/src-tauri/binaries"
task_suffix=''
case "${OS:-}" in Windows_NT) task_suffix='.exe';; esac
cp "$root/vendor/prospero/target/release/prosperod-rs$task_suffix" "$root/apps/desktop/src-tauri/binaries/prosperod-rs$task_suffix"
