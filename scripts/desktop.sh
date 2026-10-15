#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
if [ -x "$task_root/.tools/cargo/bin/cargo" ]; then
  export CARGO_HOME="$task_root/.tools/cargo" RUSTUP_HOME="$task_root/.tools/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
task_action="${1:-dev}"
if [ "$#" -gt 0 ]; then shift; fi
if [ "$task_action" = build ]; then exec pnpm --filter @obryth/desktop tauri build --features custom-protocol "$@"; fi
exec pnpm --filter @obryth/desktop tauri "$task_action" "$@"
