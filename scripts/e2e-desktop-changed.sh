#!/usr/bin/env bash
# Is a chrome told when the desktop changes under it?
#
#   nix develop .#full -c ./scripts/e2e-desktop-changed.sh
#
# With no displays configured the desktop is Domicile's own window, so unlike a
# described one it changes at runtime: a chrome reporting a 2x display makes it
# a 2x desktop, and dragging the window changes its size. The compositor
# re-advertises the `wl_output` when that happens, and it has to re-describe
# the desktop too — a `<Screen>` is laid out from the display list, not from
# the size of the chrome's own surface.
#
# Three chromes, because there are three ways to be told and each fails on its
# own. A page connected *before* the change that asked for none of it is only
# reached by a broadcast. The page that *asked* would be told either way, which
# is why it cannot stand in for the first — an earlier version of this script
# used it as both and passed against a unicast to the requester. And the page
# connecting *after* reads the retained answer, which a compositor that
# describes the desktop once at startup never updates.
#
# Needs no client and no display: the chrome protocol is the whole of it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-desktop-changed"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"; CONF="$(mktemp)"; COMP=""

# No `[[output.displays]]`, which is the whole point: this is the path where
# the window is the desktop. The size is stated rather than defaulted so the
# expectation below is about the config rather than about a constant.
cat >"$CONF" <<'TOML'
[compositor]
nested_size = [1280, 800]
TOML

"$BIN" --config "$CONF" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the job quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
cleanup() { kill -9 "$COMP" 2>/dev/null; wait 2>/dev/null; rm -f "$OUT" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do
  [ -S "$SOCK" ] && break
  sleep 0.05
done

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/redescribe-probe.ts" >"$OUT" 2>&1

echo "== the desktop each chrome ended up believing in =="
cat "$OUT"

WITNESS="$(sed -n 's/^witness: //p' "$OUT")"
ASKER="$(sed -n 's/^asker: //p' "$OUT")"
LATECOMER="$(sed -n 's/^latecomer: //p' "$OUT")"
# Before the verdict, because a probe that printed no lines at all — a missing
# dependency, a socket it could not open — would otherwise be reported as a
# compositor that described nothing, which is a delivery bug's verdict for a
# harness one. `(never told)` is the compositor's silence and fails below.
# The size is held and the density rises: a denser display is a sharper
# desktop, not a smaller one, so the mode doubles rather than the logical size
# halving. The scale is what moved, and it is what a chrome told only at
# startup still has as 1. The name is the one every client that has only ever
# seen one output has already seen.
#
# `@2` needs `output.max_scale` to allow it — it defaults to 2, and the config
# above does not restate it, so a change to that default would make this assert
# something else. Stated here rather than pinned, since restating it in the
# TOML would stop this covering the default at all.
EXPECTED="domicile-0@0,0+1280x800@2"
DECIDED=0
for who in witness asker latecomer; do
  case "$who" in
    witness) told="$WITNESS" ;;
    asker) told="$ASKER" ;;
    *) told="$LATECOMER" ;;
  esac
  # One decision per chrome, and every arm ends in a helper that exits or in
  # the pass — including the premise, which is the *first* arm rather than a
  # guard above the chain. A guard is a placement: a bail that turned into a
  # no-op on an earlier chrome would drop past it and leave this one free to
  # convict the compositor of a probe that never printed. Counting per chrome
  # is the other half — a no-op'd arm leaves that chrome undecided, and
  # `every_check_ran` says so instead of the run going green.
  if ! after "$DECIDED"; then
    harness_fault "$COMP" "the check before this one reached a verdict" \
      "ERROR: a check before this one did not reach a verdict, so nothing" \
      "  below it is a statement about the compositor."
  elif [ -z "$told" ]; then
    harness_fault "$COMP" "the probe printed a line for the $who chrome" \
      "ERROR: nothing was read for the $who chrome; see its output above." \
      "  A probe that never ran is not a chrome told nothing, and both look" \
      "  the same here."
  elif [ "$told" = "$EXPECTED" ]; then
    passed "the $who chrome ended on the desktop the window actually is"
  else
    compositor_verdict "$COMP" \
      "FAIL: the $who chrome believes the desktop is '$told'" \
      "  Expected '$EXPECTED'. A page laying out against a desktop that is" \
      "  no longer there puts every <Screen> — and so every window on one —" \
      "  somewhere the user is not looking, and nothing corrects it."
  fi
  DECIDED=$((DECIDED + 1))
done

every_check_ran 3
echo "PASS: a desktop that changes reaches every chrome — the one that asked,"
echo "      the one that did not, and the one that had not connected yet"
