#!/usr/bin/env bash
# Checks the concurrency and locking rules for workflows that run on `crux`.
#
# `crux` has two runners: `crux` holds the Chromium checkout, and `crux-light`
# runs jobs that never open it (cprussin/dotfiles:
# config/machines/crux/domicile-ci.nix). Runner queues are FIFO and never
# drop runs.
#
# A GitHub concurrency group holds one pending run, and a newer run evicts it.
# So:
#
# - The group varies with the ref, so only a newer push to the same ref
#   evicts a run.
# - A workflow that takes `engine-tree-lock.sh` never cancels in progress. A
#   killed build is safe (lld and clang write to a temp file and rename), but
#   publishing, the write-back push and the proof are not.
#   engine-cancel-stale.yml stops replaced runs only in safe steps.
# - No two workflows share a group.
#
# The cancel rule keys on the tree lock, not the runner label: a workflow that
# never opens the tree has nothing to damage, and may cancel.
#
# Two locks sit under the runners:
#
# - The tree lock (`engine-tree-lock.sh`) refuses instead of waiting. Its
#   holders all need the same runner, so waiting would deadlock.
# - The render node lock (`engine-render-node-lock.sh`) waits. A waiter holds
#   its own runner and the holder holds the other, so the holder can finish.
#   It keeps `guard-latency.sh` from timing beside another client.
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

# The top-level `concurrency:` block only: from `concurrency:` to the next
# column-zero line. Job-level blocks are indented and skipped.
concurrency_block() {
  awk '/^concurrency:/ { inside = 1; next }
       inside && /^[^[:space:]]/ { inside = 0 }
       inside { print }' "$1"
}

# One key's value from a block, or empty. Takes the first match.
field() { # block, key
  printf '%s\n' "$1" | sed -n "s/^[[:space:]]*$2:[[:space:]]*//p" | head -1
}

seen_groups=""
checked=0
resets_tree=0
leaves_tree_alone=0

# A workflow's commands without comments. These files mention
# `guard-latency.sh` in comments, which must not count as running it.
commands() { sed 's/[[:space:]]*#.*$//' "$1"; }

for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  # Scope by runner, not filename, so a new workflow on `crux` is covered.
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

  # Decide by whether a step takes the tree lock, not by the workflow's name.
  if commands "$workflow" | grep -q 'engine-tree-lock.sh'; then
    resets_tree=$((resets_tree + 1))
    case "$cancel" in
      (false) ok "$name resets the tree and never cancels a build in flight" ;;
      (*) fail "$name resets the tree and never cancels a build in flight" \
            "cancel-in-progress is '$cancel'; a cancel can land after the build, mid-publish or mid-push" ;;
    esac
  else
    leaves_tree_alone=$((leaves_tree_alone + 1))
    ok "$name does not reset the tree, so it is free to cancel (cancel-in-progress: $cancel)"
  fi

  case " $seen_groups " in
    (*" $group "*) fail "$name has a group of its own" \
      "'$group' is already another crux workflow's group, so one can evict the other's pending run" ;;
    (*) ok "$name has a group of its own"; seen_groups="$seen_groups $group" ;;
  esac
done

# Without this, a renamed runner label makes every rule above pass vacuously.
# The pattern also matches `crux-light`, which is intended: those workflows
# must not evict each other either.
if [ "$checked" -ge 2 ]; then
  ok "the crux workflows were found at all ($checked of them)"
else
  fail "the crux workflows were found at all" \
    "only $checked workflow(s) matched 'self-hosted, crux'; the rules above asserted nothing"
fi

# Each side of the cancel split needs a subject, or one side asserts nothing.
if [ "$resets_tree" -ge 1 ]; then
  ok "some crux workflow resets the tree, so the no-cancel rule has a subject ($resets_tree)"
else
  fail "some crux workflow resets the tree, so the no-cancel rule has a subject" \
    "none takes engine-tree-lock.sh, so nothing above asserted cancel-in-progress: false"
fi
if [ "$leaves_tree_alone" -ge 1 ]; then
  ok "some crux workflow leaves the tree alone ($leaves_tree_alone)"
else
  fail "some crux workflow leaves the tree alone" \
    "every crux workflow takes the tree lock, so the split below it is dead code"
fi

# --- a lock dropped is a lock taken ------------------------------------------

# The tree lock must be both taken and dropped. A `drop` alone still mentions
# `engine-tree-lock.sh`, so the rules above would pass while `engine-reset.sh`
# runs unguarded and a reset lands in another run's build. A `take` alone
# holds the tree until someone clears it.
#
# Workflows take a tree with `engine-tree-pool.sh pick`, which chooses and
# locks in one call so no run can take it in between. People run
# `engine-tree-lock.sh take` by hand. Both count.
echo "the tree lock is taken and dropped in pairs"

commands_of() { grep -v '^[[:space:]]*#' "$1"; }

tree_users=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  commands_of "$workflow" | grep -q 'engine-tree-lock\.sh' || continue
  tree_users=$((tree_users + 1))

  takes=0; drops=0
  commands_of "$workflow" |
    grep -qE 'engine-tree-lock\.sh take|engine-tree-pool\.sh pick' && takes=1
  commands_of "$workflow" | grep -qE 'engine-tree-lock\.sh drop' && drops=1

  if [ "$takes" -eq 1 ] && [ "$drops" -eq 1 ]; then
    ok "$name takes a tree and drops it"
  elif [ "$drops" -eq 1 ]; then
    fail "$name takes a tree and drops it" \
      "it drops the tree lock and never takes one, so the reset runs unguarded and a build in that checkout can be clobbered mid-link"
  else
    fail "$name takes a tree and drops it" \
      "it takes a tree and never drops it, so the next run finds it held by a job that has ended"
  fi
done

if [ "$tree_users" -ge 1 ]; then
  ok "something takes a tree at all ($tree_users)"
else
  fail "something takes a tree at all" \
    "no workflow names engine-tree-lock.sh, so the rules above asserted nothing"
fi

# --- the compile slot -------------------------------------------------------

# Two trees allow two compiles, and two cold builds run `crux` (62G, no swap)
# out of memory. Every workflow that compiles must take
# `engine-compile-slot.sh` and drop it.
echo "the compile slot is taken and dropped in pairs"

slot_users=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  commands_of "$workflow" | grep -q 'engine-compile-slot\.sh' || continue
  slot_users=$((slot_users + 1))

  takes=0; drops=0
  commands_of "$workflow" | grep -qE 'engine-compile-slot\.sh take' && takes=1
  commands_of "$workflow" | grep -qE 'engine-compile-slot\.sh drop' && drops=1

  if [ "$takes" -eq 1 ] && [ "$drops" -eq 1 ]; then
    ok "$name takes the compile slot and drops it"
  elif [ "$drops" -eq 1 ]; then
    fail "$name takes the compile slot and drops it" \
      "it drops the compile slot and never takes it, so it can compile beside another cold build"
  else
    fail "$name takes the compile slot and drops it" \
      "it takes the compile slot and never drops it, so the next cold build is refused by a job that has ended"
  fi
done

# Every workflow that picks a tree compiles in it, so it must take the slot.
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  commands_of "$workflow" | grep -q 'engine-tree-pool\.sh pick' || continue
  if commands_of "$workflow" | grep -qE 'engine-compile-slot\.sh take'; then
    ok "$name takes a tree and takes the compile slot with it"
  else
    fail "$name takes a tree and takes the compile slot with it" \
      "it builds in a tree of the pool's choosing and never takes the compile slot, so it can compile beside another cold build on a machine with no swap"
  fi
done

if [ "$slot_users" -ge 1 ]; then
  ok "something takes the compile slot at all ($slot_users)"
else
  fail "something takes the compile slot at all" \
    "no workflow names engine-compile-slot.sh, so the rules above asserted nothing"
fi

# --- the render node --------------------------------------------------------

# Two runners can put two clients on the GPU, which `guard-latency.sh` reads as
# a latency regression.
#
# `engine.yml` runs all checks in one `check.sh engine` step, so it cannot hold
# the card around just the timed guard. The lock lives in
# `scripts/engine-guard-latency.sh` instead. The rules below read both
# workflows and engine check scripts.
LOCK_SH=".github/scripts/engine-render-node-lock.sh"
[ -x "$ROOT/$LOCK_SH" ] || fail "the render node lock exists" "no $ROOT/$LOCK_SH"

# Every file that could run the timed guard or take the card: the workflows and
# the engine checks `check.sh` runs. Globbed so new files are covered.
subjects() {
  printf '%s\n' "$WORKFLOWS"/*.yml
  printf '%s\n' "$ROOT"/scripts/engine-*.sh
}

# A subject's commands, with whole-line comments removed. Trailing `#` is kept,
# since `nix develop .#full --command ...` contains one. These files mention
# `guard-latency.sh` in comments, which must not count.
commands_of() { grep -v '^[[:space:]]*#' "$1"; }

# Whether a subject takes the card. A workflow runs the lock script by path; a
# check stores the path in `$CARD` for its trap and runs `"$CARD" take`.
#
# The verb must follow one of those on the same line, and the file must name
# the render node lock, so `engine-tree-lock.sh take` does not match.
takes_card() { # subject, verb (default: either)
  commands_of "$1" | grep -q 'engine-render-node-lock\.sh' || return 1
  commands_of "$1" |
    grep -qE "(engine-render-node-lock\\.sh|\\\$\\{?CARD\\}?)\"?[[:space:]]+${2:-(take|quiet)}"
}

# `quiet`, not `take`: holding the card did not stop a compile on the other
# runner from skewing the timing (main run 36226737213).
timed=0
for subject in $(subjects); do
  [ -e "$subject" ] || continue
  name="$(basename "$subject")"
  commands_of "$subject" | grep -q 'guard-latency\.sh' || continue
  timed=$((timed + 1))

  if takes_card "$subject" quiet; then
    ok "$name times something and waits for a quiet machine first"
  else
    fail "$name times something and waits for a quiet machine first" \
      "it runs guard-latency.sh without \`$LOCK_SH quiet\`, so a compile or another run's guards read as a regression"
  fi
done

if [ "$timed" -ge 1 ]; then
  ok "something that times a guard was found at all ($timed)"
else
  fail "something that times a guard was found at all" \
    "nothing runs guard-latency.sh, so the rule above asserted nothing"
fi

# `quiet` relies on noisy work declaring itself. Every compile, reset, sync,
# packaging step, and guard run without the card must call
# `engine-render-node-lock.sh noisy` on the line that runs it.
# (`check.sh engine` declares its own; see
# `test-the-webview-guards-run-together.sh`.)
noise=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  grep -qE '^[[:space:]]*runs-on:.*self-hosted' "$workflow" || continue
  pattern='nix-shell|engine-build-in-shell\.sh|cargo build|engine-(reset|sync|release-package)\.sh'
  takes_card "$workflow" || pattern="$pattern|scripts/engine-guard-"
  while IFS= read -r line; do
    noise=$((noise + 1))
    case "$line" in
      (*engine-render-node-lock.sh\ noisy*|*engine-render-node-lock.sh\"\ noisy*)
        ok "$name declares its noise: $(printf '%s' "$line" | sed 's/^[[:space:]]*//' | cut -c1-60)" ;;
      (*)
        fail "$name declares its noise" \
          "it runs this on crux without \`$LOCK_SH noisy\`, so a latency guard can time beside it: $line" ;;
    esac
  done < <(commands_of "$workflow" | sed -e ':a' -e '/\\$/N; s/\\\n//; ta' |
             grep -E "$pattern")
done
if [ "$noise" -ge 1 ]; then
  ok "a workflow compiles something on crux ($noise)"
else
  fail "a workflow compiles something on crux" "none found, so the rule above asserted nothing"
fi

# The card must be released when a run fails or is canceled. The lock script
# steals an aged-out lock, but that is a backstop.
#
# A workflow drops it from a step with `if: ${{ always() }}`. A check drops it
# from a `trap ... EXIT`, which also runs when the take failed (`drop` is then a
# no-op).
holders=0
workflow_holders=0
script_holders=0
for subject in $(subjects); do
  [ -e "$subject" ] || continue
  name="$(basename "$subject")"
  takes_card "$subject" || continue
  holders=$((holders + 1))

  case "$subject" in
    (*.yml)
      workflow_holders=$((workflow_holders + 1))
      # The drop must be within a few lines after `always()`, i.e. in the same
      # step. Read with comments in, since `if:` and `run:` are separate lines.
      if awk -v lock="engine-render-node-lock.sh drop" '''
           /always\(\)/ { seen = NR }
           index($0, lock) && seen && NR - seen <= 4 { found = 1 }
           END { exit !found }''' "$subject"; then
        ok "$name drops the render node even when the job did not finish"
      else
        fail "$name drops the render node even when the job did not finish" \
          "its drop step has no \`if: \${{ always() }}\`, so a failed or canceled run leaves the card locked"
      fi
      ;;
    (*)
      script_holders=$((script_holders + 1))
      # The drop must be in the trap itself, not just somewhere in the file.
      # Single-quoted so grep receives `\$`; in double quotes it would get a
      # bare `$` (end of line) and never match.
      if grep -qE '^[[:space:]]*trap .*(engine-render-node-lock\.sh|\$\{?CARD\}?)"?[[:space:]]+drop' \
           "$subject"; then
        ok "$name drops the render node from a trap, however it unwinds"
      else
        fail "$name drops the render node from a trap, however it unwinds" \
          "it takes the card and never attaches the drop to a trap, so a failure between the two leaves it locked"
      fi
      ;;
  esac
done

if [ "$holders" -ge 2 ]; then
  ok "the render node is taken by more than one thing ($holders)"
else
  fail "the render node is taken by more than one thing" \
    "only $holders take $LOCK_SH; a lock one side does not take is not a lock"
fi

# Each kind of holder needs a subject, since the two rules are separate code.
if [ "$workflow_holders" -ge 1 ]; then
  ok "a workflow takes the render node ($workflow_holders)"
else
  fail "a workflow takes the render node" \
    "none does, so the always() rule above asserted nothing"
fi
if [ "$script_holders" -ge 1 ]; then
  ok "a check takes the render node ($script_holders)"
else
  fail "a check takes the render node" \
    "none does, so the trap rule above asserted nothing"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
