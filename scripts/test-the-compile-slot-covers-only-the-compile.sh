#!/usr/bin/env bash
# The compile slot is held for the compile and nothing after it.
#
# `crux` and `crux-two` share one machine and one compile slot
# (.github/scripts/engine-compile-slot.sh): 62G and no swap holds one Chromium
# link. engine.yml used to hold it from the take to the end of the job, over
# the checks, packaging, the packaged guard, publishing, the write-back and the
# proof -- none of which compiles Chromium. Over 24h the slot was busy 97% of
# the day, ~3.5h of it on checks, while the other runner's compile waited.
#
# So each workflow drops it the step after its build, and keeps the `always()`
# drop at the end for the runs that fail before getting there. `drop` is
# idempotent and leaves another run's slot alone
# (scripts/test-engine-compile-slot.sh), so dropping twice is safe.
#
# What stops a compile on the other runner from spoiling this run's latency
# guard is not this slot but the render node lock: a compile runs `noisy` and
# the latency guard waits for `quiet` (scripts/test-engine-render-node-lock.sh).
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

# workflow, the job that compiles, the step the compile ends with, and the
# first step that must not hold it -- empty when that is another job's, which
# is engine.yml's: its checks are a job of their own, and the slot's drop has
# to come before the build job ends.
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

  # Nothing after the drop may compile Chromium: that would be a compile
  # outside the slot, which is the OOM it exists to prevent.
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
