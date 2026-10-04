#!/usr/bin/env bash
# Tests that the compile slot is held for the compile and nothing after it.
#
# `crux` and `crux-two` share one machine and one compile slot
# (.github/scripts/engine-compile-slot.sh): 62G and no swap fits one Chromium
# link. Holding the slot over checks and packaging makes the other runner's
# compile wait.
#
# Each workflow drops the slot in the step after its build, and again in a
# final `always()` step for runs that fail earlier. `drop` is idempotent and
# leaves another run's slot alone (scripts/test-engine-compile-slot.sh).
#
# The render node lock, not this slot, keeps the other runner's compile from
# disturbing the latency guard (scripts/test-engine-render-node-lock.sh).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
[ -d "$WORKFLOWS" ] || { echo "no $WORKFLOWS" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A workflow's steps in order, one per line: `<line>\t<name>`.
steps() { # workflow
  grep -n '^      - name: ' "$1" | sed 's/^\([0-9]*\):      - name: /\1\t/'
}

# One step's lines, from its `- name:` to the line before the next step.
step_body() { # workflow, name
  local start end
  start="$(steps "$1" | awk -F'\t' -v n="$2" '$2 == n { print $1; exit }')"
  [ -n "$start" ] || return 0
  end="$(steps "$1" | awk -F'\t' -v s="$start" '$1 > s { print $1 - 1; exit }')"
  sed -n "${start},${end:-\$}p" "$1"
}

# The name of the step after the named one.
step_after() { # workflow, name
  steps "$1" | awk -F'\t' -v n="$2" 'hit { print $2; exit } $2 == n { hit = 1 }'
}

position() { # workflow, name
  steps "$1" | awk -F'\t' -v n="$2" '$2 == n { print NR; exit }'
}

EARLY="Drop the compile slot, the compile is done"
FINAL="Drop the compile slot"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# One job of a workflow, comments kept: from `  <job>:` to the next job.
job_of() { # workflow, job
  awk -v j="  $2:" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^  [a-z][a-z-]*:[[:space:]]*$/ { inside = ($0 == j) }
    inside { print }' "$1"
}

# workflow, the job that compiles, the step that ends the compile, and the
# first step that must not hold the slot. The last is empty for engine.yml,
# whose checks run in a separate job.
check() {
  local flow="$1" built="$3" next="$4" file="$WORK/$1.$2" body early final
  job_of "$WORKFLOWS/$flow" "$2" >"$file"
  echo "$flow ($2)"

  if [ "$(step_after "$file" "$built")" = "$EARLY" ]; then
    ok "drops the compile slot right after '$built'"
  else
    fail "drops the compile slot right after '$built'" \
      "the step after it is '$(step_after "$file" "$built")'"
  fi

  early="$(position "$file" "$EARLY")"
  if [ -z "$next" ]; then
    if [ -n "$early" ] && ! steps "$file" | cut -f2 | grep -qxF "The engine's checks"; then
      ok "and the checks are not in the job that holds it"
    else
      fail "and the checks are not in the job that holds it" \
        "'$EARLY' is step ${early:-missing} of a job that also runs the checks"
    fi
  elif [ -n "$early" ] && [ "$early" -lt "$(position "$file" "$next")" ]; then
    ok "and before '$next'"
  else
    fail "and before '$next'" "'$EARLY' is step ${early:-missing}"
  fi

  body="$(step_body "$file" "$EARLY")"
  if printf '%s\n' "$body" | grep -q 'engine-compile-slot\.sh drop "\$LOCK_OWNER"'; then
    ok "and that step is the slot's own drop"
  else
    fail "and that step is the slot's own drop" "it runs: $body"
  fi

  # A compile after the drop would run outside the slot and risk an OOM.
  if [ -n "$early" ] && steps "$file" | tail -n +"$((early + 1))" | cut -f2 |
    while IFS= read -r name; do step_body "$file" "$name"; done |
    grep -v '^[[:space:]]*#' |
    grep -qE 'engine-build-in-shell\.sh|engine-release-build\.sh|engine-build\.sh|autoninja'; then
    fail "and nothing after it compiles Chromium" \
      "a step after '$EARLY' runs a Chromium build"
  else
    ok "and nothing after it compiles Chromium"
  fi

  final="$(step_body "$file" "$FINAL")"
  if [ "$(steps "$file" | tail -1 | cut -f2)" = "$FINAL" ] &&
    printf '%s\n' "$final" | grep -q 'if: \${{ always() }}' &&
    printf '%s\n' "$final" | grep -q 'engine-compile-slot\.sh drop "\$LOCK_OWNER"'; then
    ok "and still drops it last, whatever failed"
  else
    fail "and still drops it last, whatever failed" \
      "the last step is '$(steps "$file" | tail -1 | cut -f2)'"
  fi
}

check engine.yml build "Write down what out/Release was built from" ""
check engine-release.yml release "Build" "Package"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
