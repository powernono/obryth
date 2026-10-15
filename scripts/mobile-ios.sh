#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
xcodebuild -version >/dev/null || { echo 'Install full Xcode and select its developer directory first.' >&2; exit 1; }
export IPHONEOS_DEPLOYMENT_TARGET=16.4
bash scripts/mobile-bindings.sh
for task_target in aarch64-apple-ios aarch64-apple-ios-sim; do
  bash scripts/rustup.sh target add "$task_target"
  bash scripts/cargo.sh build -p obryth-mobile --release --target "$task_target"
done
task_headers="$(mktemp -d)"
trap 'rm -rf "$task_headers"' EXIT
cp apps/mobile/modules/obryth-core/ios/generated/*FFI.h "$task_headers/"
cp apps/mobile/modules/obryth-core/ios/generated/*FFI.modulemap "$task_headers/module.modulemap"
task_framework="$task_root/apps/mobile/modules/obryth-core/ios/ObrythMobile.xcframework"
if [ -e "$task_framework" ]; then mv "$task_framework" "$task_framework.previous"; fi
xcodebuild -create-xcframework -library target/aarch64-apple-ios/release/libobryth_mobile.a -headers "$task_headers" -library target/aarch64-apple-ios-sim/release/libobryth_mobile.a -headers "$task_headers" -output "$task_framework"
