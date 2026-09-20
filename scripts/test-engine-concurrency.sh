#!/usr/bin/env bash
# The concurrency keys of the workflows that run on `crux`, asserted.
#
# `crux` has two job slots, and only one of them can touch the Chromium tree.
# `crux` is the label for the slot that holds the 97G checkout; `crux-light` is
# a second runner on the same machine for the jobs that never open it
# (cprussin/dotfiles: config/machines/crux/domicile-ci.nix). The runner queue
# in front of each is unbounded and FIFO — it makes runs wait, and it never
# throws one away.
#
# IT USED TO BE ONE SLOT, and that single slot was doing three jobs at once: it
# serialized the tree, it serialized the render node, and it made everything
# queue. The third was costing hours a day — `pinned-engine.yml` measured 1m51s
# of work behind 3h01m of queue on 2026-09-19 — so the slot was split, and the
# other two had to be written down as locks rather than left as a side effect.
# `engine-tree-lock.sh` was already one of them. `engine-render-node-lock.sh`
# is the one that had to be written.
#
# A GitHub concurrency group is not that queue. It holds exactly ONE pending
# run, and a newer run entering the group evicts whoever was pending. So a
# group shared across refs is a queue of depth one that silently discards work:
# runs 176 and 177 of `Engine` were each canceled seconds after they were
# created, by a run on a different branch, and a release can be thrown away by
# an unrelated push the same way.
#
# Hence the three rules below, one per way this goes wrong:
#
#   - the group varies with the ref, so two branches cannot evict each other
#     and only a superseded push to the SAME ref does;
#   - a workflow that resets the shared checkout never cancels a run in flight,
#     because a killed `autoninja` leaves a half-linked out/Domicile the next
#     run inherits;
#   - no two of these workflows share a group expression, because two different
#     jobs that both need to run are not supersessions of one another.
#
# THE CANCEL RULE IS NOT THE BLANKET IT USED TO BE, and the narrowing is the
# point rather than a relaxation. It was "no crux workflow cancels", which read
# as a fact about the machine and was really a fact about `autoninja`: the
# thing a cancel damages is a half-written output directory, and a job that
# never opens that directory has nothing to leave behind. `pinned-engine.yml`
# is that job -- a `fetchurl` of a published tarball, a cargo build in its own
# work directory, one guard -- and while it shared the one slot, making it wait
# rather than cancel was still right, because the run behind it in the queue
# was somebody's Chromium build. It is on a second slot now, where the thing
# behind a superseded run is another run of the same job, and making that wait
# is the discard spelled as a delay.
#
# So the rule is keyed on the tree lock rather than on the runner label: a
# workflow that takes `engine-tree-lock.sh` is one that resets the checkout,
# whatever it is called and whatever else it does. Both halves get a positive
# control below, because a split that matches nothing on one side asserts
# nothing on that side.
#
# AND THE MACHINE NOW HAS A SECOND LOCK, over the render node, because the
# second job slot took away the one the single slot was providing by accident.
# Most guards do not care; `guard-latency.sh` times sixty keystroke-to-pixel
# rounds and a second client on the card is indistinguishable from the
# regression it exists to catch. The rules for it are at the bottom: a workflow
# that times something takes the card, and a workflow that takes the card drops
# it in a step that runs even when the job was canceled -- which is the
# ordinary way a lock between two runners leaks.
#
# The tree lock (.github/scripts/engine-tree-lock.sh) is the backstop under all
# of this, and it is deliberately not a queue: it refuses and exits 1. It has
# to. A lock that waited would hold a slot the holder may need in order to
# finish — the three workflows that take it all want the same one — which is a
# deadlock rather than a queue. So the group must never be the thing standing
# between two CI runs; the slot is.
#
# The render node lock is the other way round, and the difference is which slot
# each side holds: a job waiting for the card holds its own runner and the
# holder holds the other, so the holder can always finish. That is why one lock
# refuses and the other waits, and it is the single most confusable thing here.
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
resets_tree=0
leaves_tree_alone=0

# A workflow's commands, with its comments taken out. Every rule below is about
# what a step RUNS, and this file's subjects are the most heavily commented
# YAML in the repository -- `pinned-engine.yml` names `guard-latency.sh` in a
# comment explaining why it locks the card, and a grep that could not tell the
# two apart would read that as a timed guard it is not.
commands() { sed 's/[[:space:]]*#.*$//' "$1"; }

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

  # Whether this one resets the shared checkout, asked of its steps rather than
  # of its name. A fifth workflow that takes the tree is in scope the moment it
  # takes the lock.
  if commands "$workflow" | grep -q 'engine-tree-lock.sh'; then
    resets_tree=$((resets_tree + 1))
    case "$cancel" in
      (false) ok "$name resets the tree and never cancels a build in flight" ;;
      (*) fail "$name resets the tree and never cancels a build in flight" \
            "cancel-in-progress is '$cancel'; a killed autoninja leaves a half-linked out/Domicile behind" ;;
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

# THE POSITIVE, ESTABLISHED FIRST — a loop that matched nothing reports every
# rule above as passing, which is how a renamed runner label turns this file
# into a green no-op. Four today: engine.yml, engine-release.yml,
# engine-drm-probe.yml and pinned-engine.yml. The glob is `self-hosted, *crux`,
# which matches `crux-light` too, and that is wanted: a second slot on the same
# machine is still a workflow whose group must not evict another's.
if [ "$checked" -ge 2 ]; then
  ok "the crux workflows were found at all ($checked of them)"
else
  fail "the crux workflows were found at all" \
    "only $checked workflow(s) matched 'self-hosted, crux'; the rules above asserted nothing"
fi

# AND THE POSITIVE FOR EACH SIDE OF THE SPLIT. The cancel rule above now asks a
# question with two answers, and a question everything answers the same way is
# not being asked. If every crux workflow took the tree, the "free to cancel"
# branch would be dead and nobody would notice; if none did, the rule that
# protects out/Domicile would be.
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

# --- the render node --------------------------------------------------------

# WHAT THE SECOND JOB SLOT TOOK AWAY. One slot was one job on the card; two are
# not, and `guard-latency.sh` is the guard that minds. These two rules are what
# stop that from being rediscovered as a flaky latency regression six months
# from now.
LOCK_SH=".github/scripts/engine-render-node-lock.sh"
[ -x "$ROOT/$LOCK_SH" ] || fail "the render node lock exists" "no $ROOT/$LOCK_SH"

timed=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  commands "$workflow" | grep -q 'guard-latency.sh' || continue
  timed=$((timed + 1))

  if commands "$workflow" | grep -q "$LOCK_SH take"; then
    ok "$name times something and takes the render node first"
  else
    fail "$name times something and takes the render node first" \
      "it runs guard-latency.sh without taking $LOCK_SH, so another job on the card reads as a regression"
  fi
done

if [ "$timed" -ge 1 ]; then
  ok "a workflow that times something was found at all ($timed)"
else
  fail "a workflow that times something was found at all" \
    "nothing runs guard-latency.sh, so the rule above asserted nothing"
fi

# A LOCK DROPPED ONLY ON THE HAPPY PATH IS A LOCK THAT LEAKS. A canceled run is
# the ordinary way this one leaks -- pinned-engine.yml cancels superseded runs
# now -- and the script does steal a lock that has aged out, but a ten-minute
# stall on every cancel is not a design, it is a backstop.
holders=0
for workflow in "$WORKFLOWS"/*.yml; do
  name="$(basename "$workflow")"
  commands "$workflow" | grep -q "$LOCK_SH take" || continue
  holders=$((holders + 1))

  # The drop, and an `always()` within the few lines above it — which is the
  # step it belongs to. Read off the file with its comments still in, because
  # the `if:` and the `run:` are different lines of the same step and the
  # distance between them is what says they are.
  if awk -v lock="$LOCK_SH drop" '
       /always\(\)/ { seen = NR }
       index($0, lock) && seen && NR - seen <= 4 { found = 1 }
       END { exit !found }' "$workflow"; then
    ok "$name drops the render node even when the job did not finish"
  else
    fail "$name drops the render node even when the job did not finish" \
      "its drop step has no \`if: \${{ always() }}\`, so a failed or canceled run leaves the card locked"
  fi
done

if [ "$holders" -ge 2 ]; then
  ok "both sides of the machine take the render node ($holders workflows)"
else
  fail "both sides of the machine take the render node" \
    "only $holders workflow(s) take $LOCK_SH; a lock one side does not take is not a lock"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
