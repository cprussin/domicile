#!/usr/bin/env bash
# WHICH frame `guard-client-window.sh` reads its verdict off, asserted.
#
# WHAT THIS IS ABOUT. The compositor's pixel probe lives in `publish_frame`
# (domicile-compositor's main.rs) and runs on the submit path: it samples the
# center of the browser's window, at most every 250ms, AS A CLIENT COMMITS. The
# page is up long before that and the embed is brokered by the client's own
# first commit, so the first samples are of the page itself -- white while it
# is still painting, then `spike-page.html`'s own #3f51b5 background -- and the
# client's color appears only once the engine has composited the surface it
# just took.
#
# The poll broke on the first `engine drew` OF ANY COLOR and only then compared
# that color with the client's, so whichever of those frames it happened to
# catch decided the verdict. On `Engine` run 35678677098, job 106590589908, it
# caught both of the page's:
#
#   02:21:26.792  driving kitty, drawing #3366CC
#   02:21:27.025  engine drew #FFFFFFFF      <- the page, still painting
#   02:21:27.322  engine drew #FF3F51B5      <- the page's own background
#                 control budget: client-window: the guard took 1s
#   ##[error]guard-client-window: the page is showing #FF3F51B5, which is not
#   the client's #3366CC
#
# That is a red run on a healthy seam: the same job reported `appeared=1
# brokered=1 configured=1 drew=2 stuck=0` and the engine log has `embedded
# "app-1"` in it. Nothing was wrong with the client; the guard read the wrong
# frame.
#
# WHAT IT WAITS FOR NOW is the client's own color, inside the same bound and
# with the same verdict at the end of it. The cases are that frame being read
# past the page's, the measurement the control inherits being the wait for that
# frame rather than for the page's, and the two things the bound is there for:
# a page that really is showing the wrong color still fails and still names
# both colors, and a control still fails on a frame that should not exist at
# all.
#
# The poll and the verdict are run out of the real script rather than copied,
# as `test-the-client-window-guard-outwaits-a-busy-card.sh` does, so a rewrite
# that moves them fails here loudly instead of leaving this passing against a
# version nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-client-window.sh"
[ -f "$GUARD" ] || { echo "no $GUARD" >&2; exit 1; }
# The real ones, as `test-annotate.sh` does: what a guard says is the behavior,
# and a stub that spells `::error::` itself would not be it. The verdict
# annotates and the poll writes the control's note, so both are needed.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$ROOT/packages/domicile-engine/scripts/lib-control-budget.sh"

FAILED=0
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
at_least() { # what, floor, got
  case "$3" in
    (''|*[!0-9]*) printf '  FAIL  %s\n    not a number: %s\n' "$1" "$3"
      FAILED=$((FAILED + 1)); return ;;
  esac
  if [ "$3" -ge "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted at least: %s\n    got:             %s\n' \
      "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# --- the poll and the verdict ------------------------------------------------

# From `DRAWN=""` to the `fi` that ends the note it writes down, and then the
# bare `echo` that opens the verdict to the end of the file. Both starts are
# whole lines, so neither can half-match.
BLOCK="$(awk '/^DRAWN=""$/,/^fi$/' "$GUARD")"
VERDICT="$(awk '/^echo$/,0' "$GUARD")"
[ -n "$BLOCK" ] && [ -n "$VERDICT" ] || {
  echo "no draw poll or verdict in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# What the client draws, which is the guard's own default.
CLIENT_COLOR=3366CC
# The three frames of the run above. BUILT from the format string at
# domicile-compositor's main.rs:2319 rather than copied: reword that log site
# and this test keeps passing while the guard stops seeing the line.
drew() { # $1 the color, as the compositor prints it
  printf '%s %s\n' \
    "2026-09-22T02:21:27.025Z  INFO domicile::engine::spike:" \
    "engine drew #$1 at the center of the browser's window"
}
PAGE_WHITE="$(drew FFFFFFFF)"
PAGE_INDIGO="$(drew FF3F51B5)"
CLIENT_DREW="$(drew "FF$CLIENT_COLOR")"

line() { printf '%s\n' "$2" | sed -n "$1p"; }

# The poll and the verdict, against a log that holds `$4` when the first look
# happens and gains the client's color `$3` seconds in. Prints, one per line:
# the color read, how long it waited, what the verdict exited with, what it
# said last, and the note it left for the control.
watch() { # $1 how patient, $2 NEGATIVE, $3 when the client draws or `never`,
          # $4 `the-page` or `nothing` in the log to begin with
  local dir; dir="$(mktemp -d "$WORK/XXXXXX")"
  # THE PAGE'S OWN FRAMES ARE ALREADY THERE when the poll takes its first look.
  # That is the shape of the run above — the probe fires on the client's first
  # commits, a fifth of a second after it is started, and the poll's looks are
  # a second apart — and putting them in the file rather than racing them in
  # makes the case say the same thing every time it runs.
  if [ "$4" = the-page ]; then
    printf '%s\n%s\n' "$PAGE_WHITE" "$PAGE_INDIGO" >"$dir/comp"
  else
    : >"$dir/comp"
  fi
  # Its output sent nowhere: this function is read through a command
  # substitution, and that does not return while anything still holds the write
  # end of it.
  if [ "$3" != never ]; then
    ( sleep "$3"; printf '%s\n' "$CLIENT_DREW" >>"$dir/comp" ) >/dev/null 2>&1 &
  fi
  local status
  (
    LOOKS="$1"
    NEGATIVE="$2"
    COLOR="$CLIENT_COLOR"
    COMP_LOG="$dir/comp"
    # Somewhere of its own, so a case cannot read another case's note and the
    # runner's /tmp is left alone.
    DOMICILE_CONTROL_BUDGET_DIR="$dir/budgets"
    eval "$BLOCK" 2>/dev/null
    # Written down here rather than printed after the verdict: the verdict ends
    # in `exit` on every path it has.
    printf '%s\n%s\n' "${DRAWN:-nothing}" "$WAITED" >"$dir/poll"
    eval "$VERDICT"
  ) >"$dir/out" 2>&1
  status=$?
  # The last thing it said, which is the annotation on every failing path and
  # the verdict on every passing one — without the log `annotate_from` carries
  # after a `%0A%0A`, which is what a person reading the check wants and is not
  # what a case here is about.
  local said; said="$(tail -1 "$dir/out")"
  local note; note="$(sed -n 1p "$dir/budgets/client-window" 2>/dev/null)"
  cat "$dir/poll"
  printf '%s\n%s\n%s\n' "$status" "${said%%"%0A"*}" "${note:-none}"
}

# --- which frame the verdict is about ----------------------------------------

# THE ONE THAT WENT RED ON A HEALTHY SEAM. Two of the page's own frames are in
# the log before the poll looks at all, and the client's color lands three
# seconds later. The client's is the frame this is about.
r="$(watch 240 0 3 the-page)"
expect "the client's own frame is what the poll reads" \
  "FF$CLIENT_COLOR" "$(line 1 "$r")"
expect "and the run passes on it" \
  "PASS: a Wayland client's own window is on the page, in its own color" \
  "$(line 4 "$r")"

# WHAT THE CONTROL INHERITS IS A WAIT FOR THAT FRAME. `budget_note` hands the
# negative control the guard's own measurement — `budget_for` multiplies it —
# and a poll that stopped on the page's background measured how long the page
# took to paint, which is not how long an absence has to be watched before it
# means anything. Three, because that is when the client's frame landed; the
# reading it used to leave was 0.
at_least "and the measurement the control inherits is the wait for it" \
  3 "$(line 5 "$r")"

# --- what the bound is still for ---------------------------------------------

# THE ASSERTION, UNWEAKENED. A page that never shows the client's color is the
# failure this guard exists to report, and it still reports it — naming both
# colors, which is what makes the annotation worth reading — once the bound is
# spent rather than on the first frame it sees.
r="$(watch 2 0 never the-page)"
expect "a page that never shows the client's color still fails" \
  "::error::guard-client-window: the page is showing #FF3F51B5, which is not the client's #$CLIENT_COLOR" \
  "$(line 4 "$r")"
expect "and it is the whole bound that has to expire first" "2" "$(line 2 "$r")"

# THE CONTROL, WHICH IS WHAT SAYS THE GUARD CAN FAIL AT ALL. `NEGATIVE=1`
# starts no client, so nothing draws and the absence is the correct answer.
r="$(watch 2 1 never nothing)"
expect "the negative control still passes when nothing draws" \
  "negative control: correct, nothing drew" "$(line 4 "$r")"
expect "and leaves no measurement behind for itself to read" "none" "$(line 5 "$r")"

# AND IT IS NOT MADE TO PASS BY WAITING FOR A COLOR THAT CANNOT COME. Nothing
# commits in a control run, so a frame in its log is the seam behaving in a way
# nothing here can explain — and a poll that only ever looks for the client's
# color must not read that as "nothing drew" and call the control correct.
r="$(watch 2 1 never the-page)"
expect "a control that sees a frame it should not have still fails" \
  "::error::guard-client-window: the page is showing #FF3F51B5, which is not the client's #$CLIENT_COLOR" \
  "$(line 4 "$r")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
