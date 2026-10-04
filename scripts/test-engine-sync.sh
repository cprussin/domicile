#!/usr/bin/env bash
# Asserts `engine-sync.sh` puts the checkout's DEPS at the pin, so a repin
# needs no manual step on `crux`.
#
# `engine-reset.sh` fetches the pin (tested in `test-engine-reset.sh`); this
# script syncs DEPS to it. It must:
#
# - **Skip `gclient` when warm.** A stamp beside the checkout records the pin
#   the DEPS were last synced to; a matching run does not start `gclient`.
# - **Not stamp a failed sync.** A tree between two pins that claims the new
#   one builds against a mix of both.
# - **Report a real exit status.** Chromium's toolchain shell is a buildFHSEnv
#   whose bwrap does not reliably pass a command's status through, so the sync
#   writes a sentinel and a shell that runs nothing is caught.
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

# A repository like this one: the scripts at the path whose `../..` is the
# root, and a pin file they read relative to themselves.
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

# Upstream's toolchain shell, which the sync enters to run `gclient`: the
# prebuilt binaries depot_tools fetches need its loader.
mkdir -p "$TREE/tools/nix"
echo "# upstream's shell" >"$TREE/tools/nix/shell.nix"

# depot_tools at the second location engine-depot-tools.sh checks; the first,
# /build/depot_tools, does not exist on test machines.
TOOLS="$TREE/third_party/depot_tools"
mkdir -p "$TOOLS"
touch "$TOOLS/python3_bin_reldir.txt"
printf '#!/bin/sh\nexit 0\n' >"$TOOLS/autoninja"
chmod +x "$TOOLS/autoninja"

# A fake `gclient` that logs its cwd and arguments, and can simulate the two
# ways a real one breaks a run.
GCLIENT_LOG="$WORK/gclient.log"
cat >"$TOOLS/gclient" <<EOF
#!/bin/sh
{ echo "cwd: \$PWD"; echo "args: \$*"; } >>"$GCLIENT_LOG"
# A \`managed\` solution moves the checkout to the branch head on sync, off
# the pin the series applies to.
[ -n "\${GCLIENT_MOVES_HEAD:-}" ] &&
  git -C "$TREE" -c advice.detachedHead=false checkout -q "$ELSEWHERE"
exit \${GCLIENT_EXIT:-0}
EOF
chmod +x "$TOOLS/gclient"

# A stub toolchain shell that, like upstream's, ignores arguments and runs
# NIX_SHELL_RUN. `SHELL_RUNS_NOTHING` simulates the buildFHSEnv failure: bwrap
# execs the shellHook, the command never runs, and the status is zero.
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
# `|| true`, not `|| echo 0`: `grep -c` prints 0 and exits 1 on no match, so
# the fallback would print a second line.
gclient_runs() { grep -c '^args: ' "$GCLIENT_LOG" || true; }

# ---- a repin: no stamp, so the DEPS are at some other pin ----------------

out="$(run_sync)"
expect "a checkout whose DEPS are not known to be at the pin is synced" ok "$(status "$out")"
expect "and gclient ran once" "1" "$(gclient_runs)"
# The revision is required. A `managed` solution (written by older
# depot_tools) syncs to its branch head, and the series applies only to the
# pin.
contains "pinned to the revision the series is against" \
  "--revision src@$PIN" "$(cat "$GCLIENT_LOG")"
# `.gclient` is beside the solution, not inside it.
contains "run from the directory holding .gclient" \
  "cwd: $WORK/chromium" "$(cat "$GCLIENT_LOG")"
# On NixOS, depot_tools' prebuilt binaries need the loader from upstream's FHS
# shell.
contains "inside Chromium's own toolchain shell" \
  "$TREE/tools/nix/shell.nix" "$(cat "$NIX_SHELL_LOG")"
expect "and the stamp now says which pin the DEPS are at" "$PIN" "$(cat "$STAMP")"

# ---- every ordinary run after it ----------------------------------------

# A `gclient sync` on every run would add minutes to an incremental build of
# ~1m on `crux`.
: >"$GCLIENT_LOG"
expect "a checkout already synced to the pin is left alone" ok "$(status "$(run_sync)")"
expect "and gclient is not started at all" "0" "$(gclient_runs)"

# ---- the pin moves again ------------------------------------------------

printf '%s\n' "an older pin" >"$STAMP"
: >"$GCLIENT_LOG"
expect "a stamp naming another pin is synced again" ok "$(status "$(run_sync)")"
expect "and gclient ran" "1" "$(gclient_runs)"

# ---- a sync that fails --------------------------------------------------

# Later runs trust the stamp, so a sync that did not finish must not leave
# one, or the next build uses a mix of two pins' DEPS.
printf '%s\n' "an older pin" >"$STAMP"
: >"$GCLIENT_LOG"
out="$(GCLIENT_EXIT=1 run_sync)"
expect "a gclient that fails fails the step" refused "$(status "$out")"
expect "and leaves no stamp claiming either pin" "" "$(cat "$STAMP" 2>/dev/null)"

# ---- a shell that runs nothing ------------------------------------------

# Upstream's shell is a buildFHSEnv whose shellHook execs bwrap, so
# `nix-shell` can exit 0 without running the command. That would stamp an
# unsynced tree.
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

# A workflow that resets onto a new pin without syncing DEPS does not fail; it
# builds a binary from two Chromium revisions. So every engine workflow must
# call reset, sync, apply in that order: gclient needs a clean tree at the
# pin, which the reset provides, and `apply.sh` refuses the dirty tree a sync
# leaves.
for workflow in "$ROOT"/.github/workflows/engine.yml \
                "$ROOT"/.github/workflows/engine-release.yml \
                "$ROOT"/.github/workflows/engine-drm-probe.yml; do
  name="$(basename "$workflow")"
  # Match calls only; comments also name these scripts.
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
