#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
bash scripts/cargo.sh build -p obryth-mobile
case "$(uname -s)" in Darwin) task_library=target/debug/libobryth_mobile.dylib;; Linux) task_library=target/debug/libobryth_mobile.so;; *) task_library=target/debug/obryth_mobile.dll;; esac
bash scripts/cargo.sh run -p obryth-mobile --features bindgen --bin uniffi-bindgen -- generate --library "$task_library" --metadata-no-deps --language swift --out-dir apps/mobile/modules/obryth-core/ios/generated --config crates/obryth-mobile/uniffi.toml
bash scripts/cargo.sh run -p obryth-mobile --features bindgen --bin uniffi-bindgen -- generate --library "$task_library" --metadata-no-deps --language kotlin --out-dir apps/mobile/modules/obryth-core/android/src/main/java/generated --config crates/obryth-mobile/uniffi.toml
