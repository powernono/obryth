#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to an installed Android NDK (r28 or newer)}"
bash scripts/mobile-bindings.sh
case "$(uname -s)" in Darwin) task_host=darwin-x86_64;; Linux) task_host=linux-x86_64;; *) echo 'Run from macOS or Linux with the Android NDK.' >&2; exit 1;; esac
task_toolchain="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$task_host/bin"
for task_target in aarch64-linux-android x86_64-linux-android; do
  if [ "$task_target" = aarch64-linux-android ]; then task_cc=aarch64-linux-android29-clang; task_abi=arm64-v8a; else task_cc=x86_64-linux-android29-clang; task_abi=x86_64; fi
  bash scripts/rustup.sh target add "$task_target"
  task_linker_key="CARGO_TARGET_$(echo "$task_target" | tr '[:lower:]-' '[:upper:]_')_LINKER"
  env "$task_linker_key=$task_toolchain/$task_cc" CC="$task_toolchain/$task_cc" AR="$task_toolchain/llvm-ar" RUSTFLAGS='-C link-arg=-Wl,-z,max-page-size=16384' bash scripts/cargo.sh build -p obryth-mobile --release --target "$task_target"
  mkdir -p "apps/mobile/modules/obryth-core/android/src/main/jniLibs/$task_abi"
  cp "target/$task_target/release/libobryth_mobile.so" "apps/mobile/modules/obryth-core/android/src/main/jniLibs/$task_abi/"
done
