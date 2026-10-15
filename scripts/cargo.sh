#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [ -x "$root/.tools/cargo/bin/cargo" ]; then
  export RUSTUP_HOME="$root/.tools/rustup"
  export CARGO_HOME="$root/.tools/cargo"
  export PATH="$root/.tools/cargo/bin:$PATH"
fi
exec cargo "$@"
