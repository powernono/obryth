#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
if [ -x "$task_root/.tools/cargo/bin/rustup" ]; then
  export RUSTUP_HOME="$task_root/.tools/rustup"
  export CARGO_HOME="$task_root/.tools/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
exec rustup "$@"
