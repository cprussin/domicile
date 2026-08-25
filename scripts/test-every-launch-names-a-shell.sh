#!/usr/bin/env bash
# Every script that starts the compositor says whether it wants a shell.
#
#   ./scripts/test-every-launch-names-a-shell.sh
#
# The compositor starts whatever the config names, and refuses to start when
# nothing names anything. That is right for a desktop and a trap for a script:
# there is no `domicile.toml` in this repo, so a launch that says neither
# `--shell` nor `--no-shell` gets the refusal — and the script then reports
# whatever its own first assertion is. Measured twice: a missing flag reads as
# "wl_compositor is not advertised" in one script and "the compositor exited
# before it could open a window" in another. Both are verdicts about the
# compositor, and neither mentions a flag.
#
# It is a *new* script that pays for this, which is why a human reviewing the
# diff is the wrong place to catch it: the flag was swept across every launch
# that existed, and the next one added starts without it. That has already
# happened once, from a branch that could not have known.
#
# So: grep, not judgement. A launch line names a shell decision or this fails
# and says which line.
#
# It reads one line at a time and asks only whether a flag is present, which
# leaves two shapes it is honestly wrong about — both loudly, so neither can
# pass something broken. A launch split over a line continuation fails with its
# flags on the next line, and a bare `--shell` with no value satisfies the grep
# while meaning "whatever the config names", which is the refusal this exists to
# avoid. Neither is written anywhere here; the failure text says the first.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Lines that run the compositor binary, which every script here spells `"$BIN"`
# — `run-native.sh` was the exception and was brought into line, because a
# launch written any other way is one this cannot see.
# `[ -x "$BIN" ]` and `BIN=…` are not launches; a launch is followed by a flag
# or a redirection, and `smoke-compositor.sh` is the one with a redirection —
# the case a pattern anchored on a flag misses.
launches() {
  # This file names `"$BIN"` in its own prose, so it is excluded by name rather
  # than by pattern — a checker that can match itself is one bad edit away from
  # reporting its own comments.
  grep -n '"\$BIN"' scripts/*.sh |
    grep -v '^scripts/test-every-launch-names-a-shell\.sh:' |
    grep -v '\-x "\$BIN"' |
    # Comments and the prose around them mention the binary too.
    grep -v '^[^:]*:[0-9]*: *#'
}

MISSING="$(launches | grep -v -- '--no-shell' | grep -v -- '--shell' || true)"

if [ -n "$MISSING" ]; then
  echo "FAIL: these start the compositor without saying whether they want a shell:"
  echo "$MISSING" | sed 's/^/    /'
  echo
  echo "  Add --no-shell to drive a compositor whose chrome is a stand-in of its"
  echo "  own on the socket, which is what every check here does — or --shell"
  echo "  <name-or-path> to start a real one, as e2e-shell-launch.sh does."
  echo
  echo "  If the flag is already there, it is on another line: this reads one"
  echo "  line at a time, so a launch split over a continuation hides its own"
  echo "  flags. Put them on the same line as the binary."
  exit 1
fi

# The check above finds launches by the name `"$BIN"`, so a launch spelled any
# other way is one it cannot see — and a launch it cannot see is exactly the
# thing it exists to catch. `run-native.sh` used to be spelled that other way.
#
# So the spelling is the convention, and this is what holds it: nothing runs the
# compositor except through `$BIN`. `cargo build -p domicile-compositor` and the
# `BIN=` assignment itself are the two ways to name the binary without running
# it, and neither is a path invocation.
BY_PATH="$(
  grep -nE '(^|[^-[:alnum:]_])[.$/][^ "]*/domicile-compositor([[:space:]]|$)' scripts/*.sh |
    grep -v '^scripts/test-every-launch-names-a-shell\.sh:' |
    grep -v '^[^:]*:[0-9]*: *#' |
    grep -v 'BIN=' || true
)"

if [ -n "$BY_PATH" ]; then
  echo "FAIL: these run the compositor by path rather than through \$BIN:"
  echo "$BY_PATH" | sed 's/^/    /'
  echo
  echo "  The check above finds launches by that name, so a launch spelled any"
  echo "  other way is invisible to it — including one that starts no shell and"
  echo "  refuses to boot. Set BIN once and use it."
  exit 1
fi

COUNT="$(launches | wc -l | tr -d ' ')"
# A pattern that matches nothing passes vacuously, and this one is a grep over
# a directory that gets renamed and reorganised. The floor is what stops that
# from being silent.
if [ "$COUNT" -lt 20 ]; then
  echo "FAIL: only $COUNT compositor launches found, and this repo has far more."
  echo "  The pattern has stopped matching rather than the launches having gone."
  exit 1
fi

echo "PASS: all $COUNT compositor launches name a shell decision"
