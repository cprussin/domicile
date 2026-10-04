#!/usr/bin/env bash
# Checks every engine callback into the compositor is exempt from CFI.
#
# The compositor passes the engine `DomicileEngineCallbacks`, a struct of Rust
# function pointers. Official builds enable `cfi-icall`, which traps (`ud2`)
# on an indirect call to a function the build did not compile, so the first
# callback kills the compositor. Every call through the struct must therefore
# be inside `Dispatch()`, which is marked `DISABLE_CFI_ICALL`.
#
# Reads the fork's source; needs no Chromium tree.
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

# Find calls through `callbacks_` outside `Dispatch()`, which runs from its
# signature to the next member function at the class's indentation.
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
