#!/usr/bin/env bash
# What an installed `domicile` says when it is given the wrong arguments.
#
# The order matters and is the whole check: given a path that is not a shell,
# `domicile` must complain about the SHELL rather than about the compositor or
# the engine. A binary that cannot find its own components gets there first and
# says so instead — which is the failure
# `nix-domicile-is-laid-out-to-find-itself.sh` asserts the layout against, and
# this is the same claim made from the outside, by running the thing.
#
# The desktops get the opposite question: they carry their own page, so they
# take no shell argument at all and must refuse one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

out="$(nix build --no-link --print-out-paths .#domicile)"

said="$("$out/bin/domicile" /there-is-no-such-shell 2>&1 || true)"
case "$said" in
  (*"no shell at '/there-is-no-such-shell'"*) ;;
  (*)
    echo "domicile: did not get as far as looking at the page:" >&2
    echo "$said" >&2
    exit 1
    ;;
esac

# CAPTURED AND THEN MATCHED, NOT PIPED INTO `grep -q`, and this is what
# `set -o pipefail` does to that shape: `domicile` with no shell is a usage
# error and exits non-zero, so the pipeline fails however well `grep` matched.
# Run 35552949482 failed here with `domicile: given no shell, it did not say
# so` while `domicile` was saying exactly that. The original step got away with
# it by running under `set -eu` without `pipefail`; a script that keeps
# `pipefail` -- which it should -- has to stop piping a command whose failure is
# the thing being asserted. `guard-css-and-resize.sh`'s header records the same
# trap from the other end.
said="$("$out/bin/domicile" 2>&1 || true)"
case "$said" in
  (*"which shell?"*) ;;
  (*)
    echo "domicile: given no shell, it did not say so. It said:" >&2
    echo "$said" >&2
    exit 1
    ;;
esac

for name in manganese simple; do
  desktop="$(nix build --no-link --print-out-paths ".#$name")"
  # Captured for the reason above: `--nope` is a usage error and exits
  # non-zero, which under `pipefail` fails the pipeline that proves it.
  said="$("$desktop/bin/$name" --nope 2>&1 || true)"
  case "$said" in
    (*"too many arguments"*) ;;
    (*)
      echo "$name: took an argument it has nothing to do with. It said:" >&2
      echo "$said" >&2
      exit 1
      ;;
  esac
done
echo "an installed domicile says which shell, and a desktop refuses one"
