#!/usr/bin/env bash
# Checks that every engine a guard starts listens on a broker socket no earlier
# launch used.
#
# A browser listens again when its producer goes, and that bind runs on a
# worker thread. A guard kills the browser just after its probe exits, so the
# dying browser can recreate a shared socket path after the next leg's `rm -f`.
# The next leg's probe then joins the dying browser, which never answers, and
# the check sits until its timeout.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
LIB="$SCRIPTS/lib-broker.sh"
[ -f "$LIB" ] || { echo "FAIL: no $LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Two legs in one guard, then the control in a second process, as
# `engine_guard_and_control` runs them.
legs() {
  # shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
  . "$LIB"
  BROKER="$WORK/broker"
  fresh_broker
  echo "$BROKER"
  # The first leg's dying browser listening again on its path.
  : >"$BROKER"
  fresh_broker
  echo "$BROKER"
}
first="$(legs)"
second="$(legs)"
paths="$(printf '%s\n%s\n' "$first" "$second")"

[ "$(printf '%s\n' "$paths" | sort -u | wc -l)" -eq 4 ] &&
  ok "each launch, in one guard or the next, gets its own socket path" ||
  fail "each launch, in one guard or the next, gets its own socket path" \
    "got: $(printf '%s' "$paths" | tr '\n' ' ')"
case "$paths" in
  (*"$WORK/broker"$'\n'*|*"$WORK/broker") fail "no launch takes the shared path" "got: $paths" ;;
  (*) ok "no launch takes the shared path" ;;
esac
while read -r path; do
  case "$path" in
    ("$WORK/broker-"*) ;;
    (*) fail "each path names the guard's own" "got: $path" ;;
  esac
done <<<"$paths"

# A leg must wait for its own engine's socket, not find one already there.
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$LIB"
BROKER="$WORK/fresh"
fresh_broker
: >"$BROKER"
taken="$BROKER"
fresh_broker
[ ! -e "$BROKER" ] && [ "$BROKER" != "$taken" ] &&
  ok "a new path does not exist until its engine makes it" ||
  fail "a new path does not exist until its engine makes it" "$BROKER exists"

# Every guard with a fixed broker path takes a fresh one for each engine, and
# none empties the fixed path for reuse. A guard whose broker is in its own
# `mktemp -d` directory starts one engine there.
for guard in "$SCRIPTS"/guard-*.sh; do
  grep -q 'BROKER="\${BROKER:-' "$guard" || continue
  name="$(basename "$guard")"
  grep -qE '^ *fresh_broker\b' "$guard" &&
    ! grep -q 'rm -f "\$BROKER"' "$guard" ||
    fail "$name takes a fresh broker socket for each engine" \
      "it reuses \$BROKER; call fresh_broker before starting the engine"
done
[ "$FAILED" -eq 0 ] && ok "every guard takes a fresh broker socket for each engine"

[ "$FAILED" -eq 0 ] && echo "PASS: each engine launch has its own broker socket"
[ "$FAILED" -eq 0 ]
