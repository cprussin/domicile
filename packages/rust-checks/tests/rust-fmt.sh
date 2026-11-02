#!/usr/bin/env bash
# `cargo fmt` leaves the workspace as it is.
set -u
cd "$(dirname "$0")/../../.." || exit 1
cargo fmt --all --check
