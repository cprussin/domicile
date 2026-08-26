#!/usr/bin/env bash
# Smoke test: boot the headless Domicile compositor and prove a real Wayland client
# (wayland-info) connects and binds the globals we advertise, then exits.
#
# Run inside the full shell:  nix develop .#full -c ./scripts/smoke-compositor.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}

WORK="$(mktemp -d)"
export XDG_RUNTIME_DIR="$WORK"; chmod 700 "$WORK"
trap 'kill -9 "$COMP" 2>/dev/null; rm -rf "$WORK"' EXIT

# `--no-shell` because this asks one question — do our globals reach a real
# client — and starting a chrome would answer a different one. Without it the
# compositor takes the config's shell, finds no config here, and refuses to
# start for want of one; the socket wait below still succeeds against the corpse
# and this reports `wl_compositor is not advertised`, which is a verdict about
# globals for a compositor that never served any.
"$BIN" --no-shell > "$WORK/compositor.log" 2>&1 &
COMP=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done

echo "== globals a real client binds against domicile-compositor =="
ADVERTISED="$(WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null)"
echo "$ADVERTISED" \
  | grep -oE "interface: '(wl_compositor|wl_shm|xdg_wm_base|wl_seat|wl_data_device_manager)'" \
  | sort -u

# Each of these, by name. A global a toolkit expects and does not find is not an
# error it reports — `wl_data_device_manager` was missing for months and showed
# up as the chrome freezing whenever a tab was dragged, because the engine runs
# a nested loop until a drag completes and nothing could complete it.
for global in wl_compositor wl_shm xdg_wm_base wl_seat wl_data_device_manager; do
  if ! echo "$ADVERTISED" | grep -q "interface: '$global'"; then
    echo "FAIL: $global is not advertised. A client that wants it will not say"
    echo "  so — it will wait, or quietly do without."
    exit 1
  fi
done
echo "PASS: every global a desktop's clients expect is advertised"
