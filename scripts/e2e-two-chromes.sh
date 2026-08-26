#!/usr/bin/env bash
# Does a focus change reach *every* chrome, or only the one that caused it?
#
#   nix develop .#full -c ./scripts/e2e-two-chromes.sh
#
# Focus is the desktop's, not one page's. `Host::focus_change` reports a move
# once, so a chrome that was not told has missed it for good — it marks the
# wrong window active until some unrelated page happens to connect and trigger
# the catch-up broadcast.
#
# One chrome cannot see this: sent to the connection that asked and broadcast to
# all of them look the same when there is only one. This runs two.
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-two-chromes"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"; COMP=""; APP=""

"$BIN" --no-shell --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
cleanup() { kill -9 "$COMP" "$APP" 2>/dev/null; wait 2>/dev/null; rm -f "$OUT"; }
trap cleanup EXIT
for _ in $(seq 1 200); do
  { [ -S "$SOCK" ] && [ -S "$XDG_RUNTIME_DIR/wayland-1" ]; } && break
  sleep 0.05
done

# A real client, so there is a window to focus. `focus_app` refuses an app the
# host has never seen, which would make this pass for the wrong reason.
WAYLAND_DISPLAY=wayland-1 weston-flower >/dev/null 2>&1 &
APP=$!
sleep 1

DOMICILE_CHROME_SOCK="$SOCK" bun "$ROOT/packages/e2e-harness/src/two-chrome-probe.ts" >"$OUT" 2>&1

echo "== what each chrome was told about focus =="
cat "$OUT"

FIRST="$(sed -n 's/^first: //p' "$OUT")"
SECOND="$(sed -n 's/^second: //p' "$OUT")"
# Each has to end knowing the keyboard came back to the chrome, and each has to
# have seen the window take it on the way. Trailing, not exact: a chrome
# connecting is caught up with the current holder, so the leading entries differ
# between the two by construction.
DECIDED=0
for who in first second; do
  case "$who" in
    first) told="$FIRST" ;;
    *) told="$SECOND" ;;
  esac
  # One decision per chrome, and every arm of it ends in a helper that exits or
  # in the pass — an `if` chain rather than a `case`, so the premise can be the
  # first arm rather than a guard above it. A guard is a placement: a bail that
  # turned into a no-op would drop past it into the arm below and convict the
  # compositor of a probe that printed nothing.
  if ! after "$DECIDED"; then
    harness_fault "$COMP" "the check before this one reached a verdict" \
      "ERROR: a check before this one did not reach a verdict, so nothing" \
      "  below it is a statement about the compositor."
  elif [ -z "$told" ]; then
    harness_fault "$COMP" "the probe printed a line for the $who chrome" \
      "ERROR: nothing was read for the $who chrome; see its output above." \
      "  Both routes to an empty string look alike here and only one is" \
      "  about focus: a probe that never ran is not a chrome told nothing."
  else
    case "$told" in
      *"app-1 chrome")
        passed "the $who chrome saw the window take the keyboard and give it back" ;;
      *)
        compositor_verdict "$COMP" \
          "FAIL: the $who chrome was told '$told'" \
          "  It has to end on 'app-1 chrome': the window took the keyboard and" \
          "  then gave it back. A chrome missing either move marks the wrong" \
          "  window active, and nothing will correct it." ;;
    esac
  fi
  DECIDED=$((DECIDED + 1))
done

every_check_ran 2
