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

# --- a lock dropped is a lock taken ------------------------------------------

# NOTHING HERE WAS ASKING WHETHER THE TREE LOCK IS EVER TAKEN, and a refactor
# dropped the `take` step out of `engine.yml` while leaving the `drop` in place.
# Run 35552949501 said so in one line -- `no lock at
# /build/chromium/.domicile-tree-lock to drop` -- and every rule in this file
# still passed, because the rules above find a workflow by its mention of
# `engine-tree-lock.sh` and the surviving `drop` was mention enough.
#
# What that costs is the whole point of the lock: `engine-reset.sh` runs
# unguarded, and a reset landing inside somebody's build on `crux` is silent --
# siso carries on and links a binary compiled from two different trees. A loud
# failure would have been better than a green one.
#
# So the pair is asserted as a pair, in both directions. A `take` with no `drop`
# holds the tree until a person clears it by hand; a `drop` with no `take`
# protects nothing at all.
#
# THE TAKE IS SPELLED TWO WAYS NOW. A workflow gets its tree from
# `engine-tree-pool.sh pick`, which chooses and locks in one call -- they
# cannot be two steps, because a tree chosen and then locked is a tree another
# run can take in between. A person still runs `engine-tree-lock.sh take` by
# hand, so both spellings count as taking.
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

# WHAT THE TREE POOL TOOK AWAY, the same shape as the render node below. Two
# trees is two runs compiling, and `crux` has 62G and no swap: two cold
# Chromium builds in it is an OOM kill. `engine-compile-slot.sh` is what keeps
# them to one, and it is only worth anything if every workflow that compiles
# takes it -- and drops it, or the next cold build is refused by a job that
# has ended.
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

# EVERY WORKFLOW THAT TAKES A TREE COMPILES IN IT, so every one of them is a
# subject here. A fifth that picks a tree and never takes the slot is the OOM
# this rule exists to make impossible to add quietly.
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

# WHAT THE SECOND JOB SLOT TOOK AWAY. One slot was one job on the card; two are
# not, and `guard-latency.sh` is the guard that minds. These rules are what stop
# that from being rediscovered as a flaky latency regression six months from now.
#
# THE SUBJECTS ARE NO LONGER ONLY WORKFLOWS, and that is the one thing to
# understand here. `engine.yml` used to run the timed guard from a step of its
# own and take the card around it from two more; it runs `check.sh engine`
# now, which is a single step, and holding the card for that whole group would
# be ~15 minutes of guards that do not need it — the one-queue arrangement the
# second slot exists to leave. So the lock moved into the check that wants it,
# `scripts/engine-guard-latency.sh`, and the rules follow it there.
#
# Both kinds of subject are read, because a rule that only looked at YAML would
# now assert nothing about the engine side and a rule that only looked at
# scripts would assert nothing about the light one.
LOCK_SH=".github/scripts/engine-render-node-lock.sh"
[ -x "$ROOT/$LOCK_SH" ] || fail "the render node lock exists" "no $ROOT/$LOCK_SH"

# Every file that could run the timed guard or take the card: the workflows, and
# the engine checks `check.sh` runs. Globbed rather than listed, for the reason
# the loop above globs the workflows — a sixth check that times something is in
# scope the moment it exists.
subjects() {
  printf '%s\n' "$WORKFLOWS"/*.yml
  printf '%s\n' "$ROOT"/scripts/engine-*.sh
}

# A subject's commands, with whole-line comments taken out. Not "everything
# before a `#`", which is what this used to be: the step that runs the group is
# `nix develop .#full --command ...`, and a pattern that stopped at the first
# `#` would cut it in half. These files are the most heavily commented in the
# repository — `pinned-engine.yml` names `guard-latency.sh` in a comment
# explaining why it locks the card, and so does the check that takes it — so a
# grep that could not tell prose from a command would read both as timed guards.
commands_of() { grep -v '^[[:space:]]*#' "$1"; }

# Whether a subject takes the card, asked in the two spellings there are. A
# workflow runs the lock script by path; a check keeps the path in a variable
# and runs `"$CARD" take`, because it also needs it for the drop in its trap.
#
# `take` has to follow one or the other on the same line rather than merely
# appear in the file. Both spellings are required to mention the lock at all
# first, which is what keeps `engine-tree-lock.sh take` — a different lock over
# a different thing, in the same workflow — from reading as this one.
takes_card() {
  commands_of "$1" | grep -q 'engine-render-node-lock\.sh' || return 1
  commands_of "$1" |
    grep -qE '(engine-render-node-lock\.sh|\$\{?CARD\}?)"?[[:space:]]+take'
}

timed=0
for subject in $(subjects); do
  [ -e "$subject" ] || continue
  name="$(basename "$subject")"
  commands_of "$subject" | grep -q 'guard-latency\.sh' || continue
  timed=$((timed + 1))

  if takes_card "$subject"; then
    ok "$name times something and takes the render node first"
  else
    fail "$name times something and takes the render node first" \
      "it runs guard-latency.sh without taking $LOCK_SH, so another job on the card reads as a regression"
  fi
done

if [ "$timed" -ge 1 ]; then
  ok "something that times a guard was found at all ($timed)"
else
  fail "something that times a guard was found at all" \
    "nothing runs guard-latency.sh, so the rule above asserted nothing"
fi

# A LOCK DROPPED ONLY ON THE HAPPY PATH IS A LOCK THAT LEAKS. A canceled run is
# the ordinary way this one leaks -- pinned-engine.yml cancels superseded runs
# now -- and the script does steal a lock that has aged out, but a ten-minute
# stall on every cancel is not a design, it is a backstop.
#
# HOW A SUBJECT SAYS SO DEPENDS ON WHAT IT IS, and both forms mean the same
# thing. A workflow drops it from a step carrying `if: ${{ always() }}`. A check
# has no later step to put that in, so it drops it from a `trap ... EXIT`, which
# is reached however the shell unwinds — including the run that failed to take
# the lock at all, which `drop` treats as a no-op for the tree lock's reason.
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
      # The drop, and an `always()` within the few lines above it — which is the
      # step it belongs to. Read off the file with its comments still in,
      # because the `if:` and the `run:` are different lines of the same step
      # and the distance between them is what says they are.
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
      # A trap naming the drop. Asserted as one thing rather than as "there is a
      # trap somewhere and a drop somewhere": a script with both, unconnected,
      # is a script that drops the lock only where it happens to reach the line.
      # Single-quoted, because the pattern has a `$` in it that belongs to grep
      # rather than to bash: inside double quotes `\$` reaches grep as a bare
      # `$`, which in an extended regular expression is end-of-line and matches
      # nothing here. That is a green no-op in the making — the rule reported a
      # failure it could not have reported a pass for.
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

# AND ONE OF EACH KIND, because the two rules above are different code and a
# split that matches nothing on one side asserts nothing on that side. The light
# job takes it from YAML around its one guard; the engine side takes it from
# inside the check, because its guards are one step now.
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
