#!/usr/bin/env bash
# `cargo clippy` finds nothing, warnings included.
set -u
cd "$(dirname "$0")/../../.." || exit 1
cargo clippy --workspace --all-targets -- -D warnings
