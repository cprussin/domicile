#!/usr/bin/env bash
# What makes a repin cost nobody a trip to `crux`.
#
# Moving `CHROMIUM_PIN` used to mean somebody logging into the build host and
# running `git fetch origin && gclient sync` by hand, because all three engine
# workflows only *checked* that the pin was in the checkout and stopped with an
# instruction when it was not. `.github/scripts/engine-sync.sh` is the half
# that puts the checkout's DEPS at the pin; `engine-reset.sh` fetches the pin
# itself, and `test-engine-reset.sh` asserts that half.
#
# The three things this has to get right, and all three are cheap to get wrong:
#
# - **The warm path costs nothing.** A sync on every run would put `gclient`
#   in front of every engine job on the one machine that can run them. The
#   stamp beside the checkout says which pin the DEPS were last synced to, and
#   a run whose pin matches it does not start `gclient` at all.
# - **A failed sync does not leave the stamp claiming the pin.** A tree
#   half-way between two pins that says it is at the new one is a build against
#   a mixture, which is the failure `engine-tree-lock.sh` exists to prevent by
#   another route.
# - **The exit status is real.** Chromium's toolchain shell is a buildFHSEnv
#   whose bwrap does not reliably carry a command's status out — this
#   repository has been bitten by that three times — so the sync writes a
#   sentinel and this asserts that a shell which runs nothing is caught.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNC_SH="$ROOT/.github/scripts/engine-sync.sh"
DEPS_SH="$ROOT/.github/scripts/engine-sync-deps.sh"
TOOLS_SH="$ROOT/.github/scripts/engine-depot-tools.sh"
for script in "$SYNC_SH" "$DEPS_SH" "$TOOLS_SH"; do
  [ -x "$script" ] || { echo "no $script" >&2; exit 1; }
done

command -v git >/dev/null || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}

# A repository shaped like this one: the scripts at the path whose `../..` is
# the root, and a pin file they read relative to themselves.
FAKE="$WORK/repo"
mkdir -p "$FAKE/.github/scripts" "$FAKE/packages/domicile-engine"
cp "$SYNC_SH" "$DEPS_SH" "$TOOLS_SH" "$FAKE/.github/scripts/"

# A checkout at a pin, with a second commit standing in for a later one.
TREE="$WORK/chromium/src"
mkdir -p "$TREE"
git -C "$TREE" init -q
git -C "$TREE" config user.email upstream@example.invalid
git -C "$TREE" config user.name upstream
echo "upstream" >"$TREE/upstream.cc"
git -C "$TREE" add -A
git -C "$TREE" -c commit.gpgsign=false commit -qm "the pin"
PIN="$(git -C "$TREE" rev-parse HEAD)"
echo "later" >>"$TREE/upstream.cc"
git -C "$TREE" add -A
git -C "$TREE" -c commit.gpgsign=false commit -qm "somewhere else"
ELSEWHERE="$(git -C "$TREE" rev-parse HEAD)"
git -C "$TREE" -c advice.detachedHead=false checkout -q "$PIN"
echo "# what the series is against" >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
echo "$PIN" >>"$FAKE/packages/domicile-engine/CHROMIUM_PIN"

# Upstream's toolchain shell, which the sync enters to run `gclient` — the
# prebuilt binaries depot_tools fetches need its loader, and it is the
# environment the engine build already runs in on this runner.
mkdir -p "$TREE/tools/nix"
echo "# upstream's shell" >"$TREE/tools/nix/shell.nix"

# depot_tools, at the second of the two places engine-depot-tools.sh looks —
# the first is /build/depot_tools, which no machine running this test has.
TOOLS="$TREE/third_party/depot_tools"
mkdir -p "$TOOLS"
touch "$TOOLS/python3_bin_reldir.txt"
printf '#!/bin/sh\nexit 0\n' >"$TOOLS/autoninja"
chmod +x "$TOOLS/autoninja"

# `gclient`, which records what it was asked for and where, and which can be
# told to behave like the two ways a real one ruins a run.
GCLIENT_LOG="$WORK/gclient.log"
cat >"$TOOLS/gclient" <<EOF
#!/bin/sh
{ echo "cwd: \$PWD"; echo "args: \$*"; } >>"$GCLIENT_LOG"
# A solution that is \`managed\` moves the checkout to the branch head on a
# sync, which would take the tree off the pin the series applies to.
[ -n "\${GCLIENT_MOVES_HEAD:-}" ] &&
  git -C "$TREE" -c advice.detachedHead=false checkout -q "$ELSEWHERE"
exit \${GCLIENT_EXIT:-0}
EOF
chmod +x "$TOOLS/gclient"

# The toolchain shell, stubbed the way upstream's works: everything after the
# flag is ignored and NIX_SHELL_RUN is the escape hatch that runs a command.
# `SHELL_RUNS_NOTHING` is the buildFHSEnv failure this repository has been
# bitten by three times — bwrap execs its shellHook, the command is never
# reached, and the status that comes out is zero.
STUB="$WORK/bin"
mkdir -p "$STUB"
cat >"$STUB/nix-shell" <<'EOF'
#!/bin/sh
echo "nix-shell: $*" >>"$NIX_SHELL_LOG"
[ -n "${SHELL_RUNS_NOTHING:-}" ] && exit 0
sh -c "$NIX_SHELL_RUN"
EOF
chmod +x "$STUB/nix-shell"
export PATH="$STUB:$PATH"
export NIX_SHELL_LOG="$WORK/nix-shell.log"

STAMP="$WORK/chromium/.domicile-synced-pin"
sync_it() { "$FAKE/.github/scripts/engine-sync.sh" "$TREE" 2>&1; }
run_sync() { # status on the first line, output after
  local out
  if out="$(sync_it)"; then printf 'ok\n%s\n' "$out"; else printf 'refused\n%s\n' "$out"; fi
}
status() { printf '%s\n' "$1" | head -1; }
# `|| true` rather than `|| echo 0`: `grep -c` prints the count AND exits 1
# when it is zero, so the fallback would make the answer two lines long.
gclient_runs() { grep -c '^args: ' "$GCLIENT_LOG" || true; }

# ---- a repin: no stamp, so the DEPS are at some other pin ----------------

out="$(run_sync)"
expect "a checkout whose DEPS are not known to be at the pin is synced" ok "$(status "$out")"
expect "and gclient ran once" "1" "$(gclient_runs)"
# The revision is not optional. A `managed` solution — which is what a
# `.gclient` written by an older depot_tools has — syncs the solution itself to
# the head of its branch, and the series applies to the pin and to nothing
# else.
contains "pinned to the revision the series is against" \
  "--revision src@$PIN" "$(cat "$GCLIENT_LOG")"
# Where `.gclient` is, which is beside the solution rather than inside it.
contains "run from the directory holding .gclient" \
  "cwd: $WORK/chromium" "$(cat "$GCLIENT_LOG")"
# The loader. depot_tools fetches prebuilt binaries and runs them, and outside
# upstream's FHS shell on NixOS they do not start.
contains "inside Chromium's own toolchain shell" \
  "$TREE/tools/nix/shell.nix" "$(cat "$NIX_SHELL_LOG")"
expect "and the stamp now says which pin the DEPS are at" "$PIN" "$(cat "$STAMP")"

# ---- every ordinary run after it ----------------------------------------

# THE NUMBER THAT MATTERS. `crux` has one job slot and an incremental engine
# build is ~1m; a `gclient sync` in front of every run would be minutes of it,
# every time, for a tree that has not moved.
: >"$GCLIENT_LOG"
expect "a checkout already synced to the pin is left alone" ok "$(status "$(run_sync)")"
expect "and gclient is not started at all" "0" "$(gclient_runs)"

# ---- the pin moves again ------------------------------------------------

printf '%s\n' "an older pin" >"$STAMP"
: >"$GCLIENT_LOG"
expect "a stamp naming another pin is synced again" ok "$(status "$(run_sync)")"
expect "and gclient ran" "1" "$(gclient_runs)"

# ---- a sync that fails --------------------------------------------------

# The stamp is what every later run trusts, so a sync that did not finish must
# not leave one. Half of one pin's DEPS and half of another's, described as
# either, is a build against a mixture.
printf '%s\n' "an older pin" >"$STAMP"
: >"$GCLIENT_LOG"
out="$(GCLIENT_EXIT=1 run_sync)"
expect "a gclient that fails fails the step" refused "$(status "$out")"
expect "and leaves no stamp claiming either pin" "" "$(cat "$STAMP" 2>/dev/null)"

# ---- a shell that runs nothing ------------------------------------------

# upstream's shell is a buildFHSEnv whose shellHook execs bwrap, so `nix-shell`
# can exit 0 having never reached the command. Three of this repository's CI
# steps have been written around that; here it would mean a tree nobody synced,
# stamped as synced, and a build against the wrong DEPS.
: >"$GCLIENT_LOG"
out="$(SHELL_RUNS_NOTHING=1 run_sync)"
expect "a shell that swallows the command is caught" refused "$(status "$out")"
contains "and says the sync did not run" "did not run" "$out"
expect "with no stamp" "" "$(cat "$STAMP" 2>/dev/null)"

# ---- a sync that moves the checkout off the pin -------------------------

: >"$GCLIENT_LOG"
out="$(GCLIENT_MOVES_HEAD=1 run_sync)"
expect "a sync that moves the checkout off the pin is refused" refused "$(status "$out")"
contains "and names what the tree is at now" "$ELSEWHERE" "$out"
expect "with no stamp" "" "$(cat "$STAMP" 2>/dev/null)"
git -C "$TREE" -c advice.detachedHead=false checkout -q "$PIN"

# ---- no depot_tools -----------------------------------------------------

mv "$TOOLS/python3_bin_reldir.txt" "$WORK/bootstrap-gone"
: >"$GCLIENT_LOG"
out="$(run_sync)"
expect "a depot_tools that was never bootstrapped is refused" refused "$(status "$out")"
contains "and the message says which two places were looked in" \
  "third_party/depot_tools" "$out"
mv "$WORK/bootstrap-gone" "$TOOLS/python3_bin_reldir.txt"

# ---- every workflow that resets that tree also syncs it ------------------

# THE DRIFT THIS CATCHES IS SILENT, which is why it is a check rather than a
# convention. A workflow that resets the checkout onto a new pin and never
# syncs its DEPS does not fail: it builds, against a `src` at one revision and
# a `third_party` at another, and what comes out is a binary compiled from two
# Chromiums. That is the same failure `engine-tree-lock.sh` exists to prevent
# from the other direction, and it is just as invisible.
#
# The order matters as much as the presence. gclient wants a tree that is
# clean and at the revision it is syncing for — the reset is what makes it one
# — and `apply.sh` refuses a dirty tree, which a sync leaves behind. So:
# reset, sync, apply.
for workflow in "$ROOT"/.github/workflows/engine.yml \
                "$ROOT"/.github/workflows/engine-release.yml \
                "$ROOT"/.github/workflows/engine-drm-probe.yml; do
  name="$(basename "$workflow")"
  # The calls only, in the order they are made: comments mention these scripts
  # by name and would otherwise count as calls.
  calls="$(grep -o '\(engine-reset\.sh\|engine-sync\.sh\|apply\.sh\) "\$CHROMIUM"' "$workflow" |
             sed 's/ .*//' | tr '\n' ' ')"
  expect "$name resets, then syncs, then applies" \
    "engine-reset.sh engine-sync.sh apply.sh " "$calls"
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
