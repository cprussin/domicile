#!/usr/bin/env bash
# An <app> is a replaced element, and a resize reaches the producer.
#
# Requirement 2, and for a long time nothing ran it: `guard-css-and-resize.sh`
# measures six CSS properties applied to an <app> and to an ordinary <div> laid
# out identically beside it, then a resize, which gets a page of its own
# because it moves the LocalSurfaceId every element in a document shares. Its
# own header said it had only ever been run by hand — which was true, and was
# true because the only thing that ran it was forty lines of YAML.
#
# INSIDE CHROMIUM'S OWN TOOLCHAIN SHELL, not the `.#full` the rest of the group
# runs in, and that is what `spike.sh` documents: a component build links
# against that shell's glibc. This is the one check here that reaches for a
# second shell, and the sentinel below is why it is worth the lines: that shell
# has swallowed an exit status before, and the step that believed it reported a
# measurement nobody took.
#
# Headless and software-composited, which is `spike.sh`'s default and needs no
# nested compositor: what it compares is what the display compositor drew for
# two elements on one page, and neither needs a GPU to be laid out.
# ENGINE-FORK.md's `--disable-gpu` table is the one this reproduces — six cells
# bit-exact, `transform` differing on 285 edge pixels and 0 interior ones,
# which is two software raster passes disagreeing in the last bit. The verdict
# is on interior pixels for exactly that reason, so those 285 are a pass here
# and every cell is 0 on the GPU. Which is what makes a failure the seam rather
# than the hardware, and the only reading that makes this worth having.
#
# NO CONTROL RUN: the comparison is the control. Every cell is measured against
# an ordinary <div> under the same properties in the same document, so a run
# where nothing was drawn at all has no <div> to agree with either.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# The sentinel, and the reason for the shape of everything below it. `nix-shell`
# here has exited 0 over a guard that failed, so the status is not evidence:
# what is, is a file the guard's own last line creates.
RAN=/tmp/domicile-css-and-resize-ran
LOG=/tmp/domicile-css-and-resize-shell.log
rm -f "$RAN"

# `nix-shell` reads `NIX_PATH` rather than the flake, and the runner has none.
nixpkgs="$(nix eval --raw --impure --expr '(builtins.getFlake "nixpkgs").outPath')"
export NIX_PATH="nixpkgs=$nixpkgs"

RUN=/tmp/domicile-css-and-resize-run
cat > "$RUN" <<INNER
#!/usr/bin/env bash
set -euo pipefail
"$ENGINE_SCRIPTS/guard-css-and-resize.sh" "$ENGINE_DIR"
touch "$RAN"
INNER
chmod +x "$RUN"

# WITHOUT THE LOADER PATH THIS CHECK INHERITED, which is the one thing about
# entering that shell from inside `.#full` that is not the same as entering it
# from a workflow step. flake.nix exports `LD_LIBRARY_PATH` there —
# `/run/opengl-driver/lib`, the GL stack, `engineRuntimeLibs` — because the
# compositor `dlopen`s libEGL and `mkShell` only wires build-time linkage. It is
# exactly wrong here: Chromium's shell is a buildFHSEnv whose `/lib/libc.so.6`
# is the FHS glibc, so those nixpkgs libraries arrive resolved against a glibc
# that is not the one loading them, and chrome does not start at all:
#
#   out/Domicile/chrome: /lib/libc.so.6: version `GLIBC_ABI_GNU2_TLS' not found
#     (required by /nix/store/...-systemd-261.2/lib/libudev.so.1)
#
# `spike.sh` then waits out its sixty looks for a socket nothing will bind and
# reports `the page never asked to embed`, and this check reports the catch-all
# half of its verdict. Run 35678987261 attempt 2, with the fourteen checks
# before it green.
#
# THE TWO THE LOADER READS AND NO MORE. `.#full` also sets the compiling
# variables — `PKG_CONFIG_PATH`, `NIX_CFLAGS_COMPILE` — and nothing inside this
# shell compiles: `spike.sh` runs `out/Domicile/chrome` and the producer beside
# it, both already linked by the build. So this drops what would be misread
# rather than scrubbing the environment, which would be a second, worse copy of
# what buildFHSEnv already decides.
# `scripts/test-chromiums-shell-is-entered-clean.sh` asserts it against a
# stand-in, since the symptom needs a Chromium build and the fix does not.
if env -u LD_LIBRARY_PATH -u LD_PRELOAD \
     NIX_SHELL_RUN="$RUN" nix-shell "$ENGINE_DIR/tools/nix/shell.nix" \
     >"$LOG" 2>&1; then
  echo "the shell exited 0"
else
  echo "the shell exited $?"
fi

# Not 60. A clean run is about that long on its own — a header, one `embedded`
# line per canvas, the per-property table, the latency block, then the whole
# resize run again — so any chatter from the shell pushes the table, which is
# the only place the verdict lives, off the top of what gets printed.
tail -200 "$LOG" | sed 's/^/  | /'

[ -e "$RAN" ] || {
  # The guard says which half failed and why, because it is the thing that
  # knows: it holds the two exit statuses and each half's own log. Three
  # versions of this tried to work that out from one grep over the pair, and
  # review found each of them naming the wrong end — including `grep -v … |
  # grep -q …` losing to SIGPIPE under `pipefail` past about 128 KB of log and
  # routing a real cell failure to the catch-all. So this quotes rather than
  # classifies, and the only sentence it owns is the one for a run that never
  # got as far as saying anything.
  #
  # `|| :` because a grep that matches nothing exits 1 under `set -e`, which
  # killed the shell here on the assignment and made the fallback below
  # unreachable: a run that said nothing got no annotation at all. Same class
  # of mistake as the SIGPIPE one, one line lower down.
  said="$( { grep -a '^step 4 failed:' "$LOG" || :; } | tail -1)"
  if [ -n "$said" ]; then
    annotate "$said"
  else
    annotate "the css-and-resize guard never reached its own verdict — the" \
      "producer did not finish, or the shell around it did not start. Its" \
      "last words are above, and the whole log is in $LOG"
  fi
  exit 1
}
