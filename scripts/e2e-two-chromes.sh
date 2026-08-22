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

"$BIN" --chrome-socket "$SOCK" >/dev/null 2>&1 &
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
# Before the verdict, because both routes to an empty string look identical
# here and only one of them is about focus: a probe that never printed its
# lines at all — a missing dependency, a socket it could not open — would
# otherwise be reported as a chrome that was told nothing, which is three
# lines of confident prose about the wrong thing.
if [ -z "$FIRST" ] || [ -z "$SECOND" ]; then
  echo "ERROR: the probe printed no focus lines; see its output above."
  echo "  That is this script's harness, not the compositor's delivery."
  exit 99
fi
# Each has to end knowing the keyboard came back to the chrome, and each has to
# have seen the window take it on the way. Trailing, not exact: a chrome
# connecting is caught up with the current holder, so the leading entries differ
# between the two by construction.
for who in first second; do
  case "$who" in
    first) told="$FIRST" ;;
    *) told="$SECOND" ;;
  esac
  case "$told" in
    *"app-1 chrome")
      echo "OK: the $who chrome saw the window take the keyboard and give it back" ;;
    *)
      echo "FAIL: the $who chrome was told '$told'"
      echo "  It has to end on 'app-1 chrome': the window took the keyboard and"
      echo "  then gave it back. A chrome missing either move marks the wrong"
      echo "  window active, and nothing will correct it."
      exit 1 ;;
  esac
done
echo "PASS: a focus change reaches every chrome, not just the one that caused it"
