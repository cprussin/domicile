#!/usr/bin/env bash
# A display for a script that needs one, and a reason when there is none.
#
# Four e2e scripts each opened their own X server, discarded what it said, and
# waited on the clock alone — so `Xvfb never came up` was all any of them could
# report, which is the question restated rather than an answer. Worse, two of
# them are gated by `check.sh` on `$DISPLAY` being set and then started a
# second server regardless: a run where the outer server came up and the inner
# one did not failed with nothing anywhere to say why.
#
# Both halves are fixed here rather than four times over. `check.sh` keeps its
# own copy of the starting — it reports into an environment section, has to
# tell "no Xvfb installed" from "Xvfb would not start", and carries the reason
# forward into every later skip line — but the sentence both produce is the one
# function, in `xvfb-verdict.sh`.

XVFB_DISPLAY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/xvfb-verdict.sh
. "$XVFB_DISPLAY_ROOT/scripts/xvfb-verdict.sh"
# Asked of the function rather than of the `.`, because a file that is present
# but empty sources cleanly and defines nothing — the quieter of the two ways
# this wire can break, and the one no error message would precede.
declare -F xvfb_verdict >/dev/null || {
  echo "no xvfb_verdict — scripts/xvfb-verdict.sh would not load" >&2
  exit 1
}

# Make sure `$DISPLAY` names a live X server, starting one if it has to.
#
# `$1` is the screen geometry and `$2` how many seconds a server gets to name a
# display; both apply only when it starts one, and a caller that inherits a
# display inherits its geometry with it. Exports `DISPLAY` — for a child rather
# than for the caller, since Electron is what has to see it — and sets `XVFB`
# to the server it started, empty when it took the caller's, which is what
# stops a script killing a display it did not make on its way out.
#
# Returns 1 with the reason on stdout when no display can be had, so a caller
# is a `|| exit 1` rather than a block of its own.
ensure_display() {
  local geometry="$1" deadline="$2" named log

  # The caller's display, when there is one. `check.sh` has already made a
  # server and gated this script on it; a second one buys nothing and is one
  # more thing to fail silently. Standalone, there is nothing to inherit and
  # the branch below runs.
  if [ -n "${DISPLAY:-}" ]; then
    XVFB=""
    return 0
  fi

  named="$(mktemp)"
  log="$(mktemp)"
  # `-displayfd`, so the server picks the number and says which. Picking one
  # ourselves collides with whatever a previous run left behind, and there is
  # no way from a shell to tell a live X server from a dead one's socket —
  # which is how a stale `/tmp/.X11-unix/X97` once became an Electron segfault
  # that looked like a bug in the shell.
  Xvfb -displayfd 3 -screen 0 "$geometry" 3>"$named" >"$log" 2>&1 &
  XVFB=$!
  # Until it names a display, or dies, or the deadline passes. Watching only
  # the file spends the whole deadline on a server that is already dead, and
  # then reports it exactly like one that was merely slow.
  #
  # `check.sh` has the same loop, for the server it starts itself. Two copies
  # rather than a third file to source, but they are a pair: a fix to the
  # waiting here is a fix there.
  local _
  for _ in $(seq 1 $((deadline * 10))); do
    [ -s "$named" ] && break
    kill -0 "$XVFB" 2>/dev/null || break
    sleep 0.1
  done

  if [ -s "$named" ]; then
    DISPLAY=":$(tr -d '[:space:]' <"$named")"
    export DISPLAY
    rm -f "$named" "$log"
    return 0
  else
    # `XVFB` is left set on purpose: a server that is alive but never ready is
    # still ours to kill, and the caller's trap is what does it.
    echo "FAIL: no display — $(xvfb_verdict "$XVFB" "$log" "$deadline")"
    rm -f "$named" "$log"
    return 1
  fi
}
