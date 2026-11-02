#!/usr/bin/env bash
# `cargo test` passes for the whole workspace.
#
# The only Rust check that links, so it can fail for reasons outside the code;
# `lib/rust-check.sh` skips it then.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=packages/rust-checks/lib/rust-check.sh
. "$ROOT/packages/rust-checks/lib/rust-check.sh"
require_linkable_libraries
cd "$ROOT" || exit 1
# `--no-fail-fast` so every failing test binary is reported, not only the
# first.
cargo test --workspace --no-fail-fast
