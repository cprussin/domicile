#!/usr/bin/env bash
# The concurrency keys of the workflows that run on `crux`, asserted.
#
# `crux` has one job slot. That slot is what actually keeps two writers out of
# /build/chromium/src between CI runs: a job holds it from `actions/checkout`
# to the `if: always()` drop, and GitHub hands it to the next job only after
# that. The runner queue in front of it is unbounded and FIFO — it makes runs
# wait, and it never throws one away.
#
# A GitHub concurrency group is not that queue. It holds exactly ONE pending
# run, and a newer run entering the group evicts whoever was pending. So a
# group shared across refs is a queue of depth one that silently discards work:
# runs 176 and 177 of `Engine` were each cancelled seconds after they were
# created, by a run on a different branch, and a release can be thrown away by
# an unrelated push the same way.
#
# Hence the three rules below, one per way this goes wrong:
#
#   - the group varies with the ref, so two branches cannot evict each other
#     and only a superseded push to the SAME ref does;
#   - `cancel-in-progress: false`, because a Chromium build is four hours and a
#     killed `autoninja` leaves a half-linked out/Domicile the next run inherits;
#   - no two of these workflows share a group expression, because two different
#     jobs that both need to run are not supersessions of one another.
#
# The tree lock (.github/scripts/engine-tree-lock.sh) is the backstop under all
# of this, and it is deliberately not a queue: it refuses and exits 1. It has
# to. A lock that waited would hold the one slot the holder needs in order to
# finish, which on a single-slot runner is a deadlock rather than a queue. So
# the group must never be the thing standing between two CI runs — the slot is.
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

# The top-level `concurrency:` block only. A workflow's top-level keys are at
# column zero, so the block runs from `concurrency:` to the next such line —
# which is also what keeps a job-level `concurrency:` (indented) from being
# read as this one.
concurrency_block() {
  awk '/^concurrency:/ { inside = 1; next }
       inside && /^[^[:space:]]/ { inside = 0 }
       inside { print }' "$1"
}

# One key's value out of a block, empty if the block does not carry it. The
# first match only: a key repeated in a YAML mapping is a file GitHub would
# reject anyway, and taking the first is what a reader does.
field() { # block, key
  printf '%s\n' "$1" | sed -n "s/^[[:space:]]*$2:[[:space:]]*//p" | head -1
}

seen_groups=""
checked=0

for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  # The machine, not the filename: a fourth workflow that reaches for that tree
  # is in scope the moment it asks for the runner, whatever it is called.
  grep -q 'self-hosted, *crux' "$workflow" || continue
  checked=$((checked + 1))

  block="$(concurrency_block "$workflow")"
  group="$(field "$block" group)"
  cancel="$(field "$block" cancel-in-progress)"

  if [ -z "$group" ]; then
    fail "$name declares a concurrency group" "it has no top-level concurrency.group"
    continue
  fi

  case "$group" in
    (*github.ref*) ok "$name keys its concurrency group by ref" ;;
    (*) fail "$name keys its concurrency group by ref" \
          "group is '$group', which is the same for every branch — a push to one branch evicts another's pending run" ;;
  esac

  case "$cancel" in
    (false) ok "$name never cancels a build in flight" ;;
    (*) fail "$name never cancels a build in flight" \
          "cancel-in-progress is '$cancel'; a killed autoninja leaves a half-linked out/Domicile behind" ;;
  esac

  case " $seen_groups " in
    (*" $group "*) fail "$name has a group of its own" \
      "'$group' is already another crux workflow's group, so one can evict the other's pending run" ;;
    (*) ok "$name has a group of its own"; seen_groups="$seen_groups $group" ;;
  esac
done

# THE POSITIVE, ESTABLISHED FIRST — a loop that matched nothing reports every
# rule above as passing, which is how a renamed runner label turns this file
# into a green no-op. Two today: engine.yml and engine-release.yml.
if [ "$checked" -ge 2 ]; then
  ok "the crux workflows were found at all ($checked of them)"
else
  fail "the crux workflows were found at all" \
    "only $checked workflow(s) matched 'self-hosted, crux'; the rules above asserted nothing"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
