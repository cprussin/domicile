#!/usr/bin/env bash
# Whether the engine can call the compositor back in an official build.
#
# `libdomicile_engine.so` is loaded by the compositor, which hands it a struct
# of function pointers -- `configure`, `frame`, `released` and the rest of
# `DomicileEngineCallbacks` -- written in Rust. An official build has CFI on,
# and `cfi-icall` checks every indirect call against a jump table of the
# functions the build itself compiled with that type. A Rust function is in no
# such table, so the first callback the engine makes is `ud2`: the compositor
# dies of "Illegal instruction" the moment a client's window is brokered.
# Production run 36349359457 did exactly that, eight hours into its build.
#
# So the one function that makes those calls is `DISABLE_CFI_ICALL`, and every
# call through the struct has to be in it: a callback made from anywhere else
# is the same trap, one refactor later.
#
# NO CHROMIUM TREE: this reads the fork's own source, which is laid down as-is.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine/src/components/domicile/engine/domicile_engine.cc"
[ -f "$ENGINE" ] || { echo "no engine at $ENGINE" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

if grep -qE '^[[:space:]]*DISABLE_CFI_ICALL void Dispatch\(\)' "$ENGINE"; then
  ok "the engine's dispatch is exempt from cfi-icall"
else
  fail "the engine's dispatch is exempt from cfi-icall" \
    "no 'DISABLE_CFI_ICALL void Dispatch()' in domicile_engine.cc"
fi

# Every call through the callbacks struct, and whether it is inside Dispatch:
# from its signature to the next member function at the class's indentation.
outside="$(awk '
  /^  (DISABLE_CFI_ICALL )?void Dispatch\(\)/ { inside = 1; next }
  inside && /^  [A-Za-z~].*\(.*\) *(const )?\{$/ { inside = 0 }
  /callbacks_\.[a-z_]+\(/ && !inside { print FNR": "$0 }
' "$ENGINE")"
calls="$(grep -cE 'callbacks_\.[a-z_]+\(' "$ENGINE")"
if [ "$calls" -gt 0 ] && [ -z "$outside" ]; then
  ok "and all $calls calls into the compositor are made from it"
else
  fail "and all calls into the compositor are made from it" \
    "${outside:-no call through callbacks_ was found at all}"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
