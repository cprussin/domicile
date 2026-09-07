#!/usr/bin/env bash
# Which end step 4 blames, and which half it blames it on.
#
# The unit is `half_verdict` and the summary block in `spike-step4.sh` — what
# turns two exit statuses and two logs into the one line the workflow prints.
#
# It exists because three versions of that sentence lived in the workflow step
# instead, greping over both halves at once, and every one of them named the
# wrong end: a resize that disagreed about its own boxes reported as "never got
# as far as a verdict"; a seam failure in the resize half reported as "the
# instrument, not the seam" because the CSS half's probe had also stalled; and
# `grep -v … | grep -q …` losing to SIGPIPE under `pipefail` on a long log and
# sending a real cell failure to the catch-all. None of them was ever run.
#
# Both pieces are taken out of the real script rather than copied, so a rewrite
# that moves them fails here loudly instead of leaving this passing against a
# version nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEP4="$ROOT/packages/domicile-engine/scripts/spike-step4.sh"

# From `half_verdict() {` to the `}` in column 0 that closes it.
VERDICT="$(awk '/^half_verdict\(\) \{/,/^\}$/' "$STEP4")"
# From the `if` that reads FAILED to the `fi` that closes it.
SUMMARY="$(awk '/^if \[ \$FAILED -eq 0 \]; then$/,/^fi$/' "$STEP4")"
for piece in VERDICT SUMMARY; do
  [ -n "${!piece}" ] || {
    echo "no $piece in $STEP4 — its markers moved. Fix this test with it." >&2
    exit 1
  }
done
eval "$VERDICT"

FAILED_COUNT=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

# BUILT from css_parity.cc's own printf sites, not copied from a run: nothing in
# CI had ever produced one when this was written. The table's shape is from
# `:329`, the verdict strings from `:370-380` and `:549-553`, the latency lines
# from `:410` and `:476`, and the resize refusals from `:566-584`.
TABLE_HEAD='property             pixels   differ   interior    worst in effect  verdict'
ROW_PASS='z-index               53200        0          0        0       yes  pass'
ROW_EDGES='transform             53200      285          0       84       yes  pass (edges only)'
ROW_FAIL='opacity               53200      412        118       97       yes  FAIL'
ROW_FAIL_BARE='mix-blend-mode        53200      412        118       97       yes  FAIL'
ROW_NOT_IN_EFFECT='opacity               53200        0          0        1        no  FAIL (the property is not in effect)'
# `ReportResize` prints a bare FAIL in the verdict column (`css_parity.cc:601`);
# the `FAIL — …` wording belongs to the iframe check (`:549-553`). Both are
# here because both are strings this has to recognise.
RESIZE_FAIL='resize                53200      900        740      255  FAIL'
IFRAME_FAIL='transform             53200      900        740      255  FAIL — differs beyond its edges'
LATENCY_OK='latency over 60 samples, producer submit to the colour appearing in the display compositor'"'"'s own output:'
LATENCY_DEAD='latency: the probe stopped answering'
# The OTHER `latency:` line, and the opposite end: the probe answered every
# time and the colour never arrived. `css_parity.cc:459`.
LATENCY_NEVER='latency: FF00C853 never appeared after 200 draws'
RESIZE_BOXES='expected 180x130, the page and this disagree about its own boxes'
RESIZE_PRODUCER='the producer is rendering at 120x90, not 180x130'
NOT_RECONFIGURED='the page never reconfigured'

log() { local f; f="$(mktemp "$FIXTURES/XXXXXX")"; printf '%s\n' "$@" >"$f"; echo "$f"; }

# --- half_verdict, one half at a time ------------------------------------

expect "a cell marked FAIL is a cell marked FAIL" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_FAIL" "$LATENCY_OK")")"

# The verdict column's last field, with nothing after it. A pattern anchored on
# a trailing space would miss this and blame the wrong end.
expect "a bare FAIL at the end of a row counts" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL_BARE")")"

expect "FAIL with a reason in brackets counts" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_NOT_IN_EFFECT")")"

expect "the resize half's bare FAIL counts" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$RESIZE_FAIL")")"

expect "the iframe check's FAIL wording counts" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$IFRAME_FAIL")")"

# THE CASE THE `[^E]` IS FOR. This function feeds a line that says FAILED, and
# a run of it against its own output must not answer its own question.
expect "the word FAILED is not a cell" \
  "neither a cell nor the probe; its own last words are above" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "step 4 failed: something" "FAILED")")"

# THE CASE THAT PINS THE ORDER, and the one no fixture had: both a failed cell
# and a failed probe, which is the realistic log rather than a contrived one.
# `css_passed_` is decided before the latency phase and the phase runs anyway,
# and a renderer stalled enough to exhaust the poll budget is exactly what also
# mismatches a cell. Asked probe-first, this says the instrument about a
# property that really did behave differently.
expect "a failed cell outranks a failed probe" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_DEAD")")"

# And the other end of the same pair.
expect "a failed cell outranks a colour that never arrived" \
  "a cell is marked FAIL" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_NEVER")")"

# THE CASE THAT PINS THE ANCHOR. A half that fails for its own reason and still
# completes its latency phase carries `latency over 60 samples…`, which is not
# a failure at all. A grep for `latency` rather than `^latency: ` reads this as
# a stalled probe and blames the instrument for a page that did not fit.
expect "a completed latency block is not a failed probe" \
  "neither a cell nor the probe; its own last words are above" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "off the window: the page does not fit" "$LATENCY_OK")")"

# THE TWO `latency:` LINES ARE OPPOSITE ENDS. One grep for the prefix called
# both the instrument; `never appeared` is the producer's pixels not arriving,
# which is the seam and the worst thing this script can find.
expect "a colour that never arrived is the seam, not the instrument" \
  "every cell passed and then a colour the producer submitted never reached the screen, which is the seam" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_NEVER")")"

expect "a clean table and a dead probe is the instrument" \
  "every cell passed and the probe then stopped answering, which is the instrument rather than the seam" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES" "$LATENCY_DEAD")")"

# `pass (edges only)` is what `transform` gets under software rasterisation on
# every run. A pattern matching it as a failure would fail every green run.
expect "edges-only is a pass, not a cell failure" \
  "neither a cell nor the probe; its own last words are above" \
  "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES")")"

for case in "$RESIZE_BOXES" "$RESIZE_PRODUCER" "$NOT_RECONFIGURED"; do
  expect "a producer refusal is not blamed on a cell or the probe" \
    "neither a cell nor the probe; its own last words are above" \
    "$(half_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$case")")"
done

# --- the summary, both halves at once -------------------------------------

summary() { # $1 CSS status, $2 CSS log, $3 resize status, $4 resize log
  (
    FAILED=1
    CSS="$1"; CSS_LOG="$2"
    RESIZE="$3"; RESIZE_LOG="$4"
    eval "$SUMMARY" 2>&1 >/dev/null
  )
}

CLEAN="$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_OK")"
CELL="$(log "$TABLE_HEAD" "$ROW_FAIL")"
PROBE="$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_DEAD")"
BOXES="$(log "$TABLE_HEAD" "$ROW_PASS" "$RESIZE_PRODUCER")"

expect "only the CSS half failing names only the CSS half" \
  "step 4 failed: the CSS half, a cell is marked FAIL." \
  "$(summary 1 "$CELL" 0 "$CLEAN")"

# THE DEFECT THIS WHOLE FILE IS FOR. The resize half failed at the seam and the
# CSS half's probe stalled; the version that greped both at once announced the
# instrument and sent the reader away from the failure.
expect "a stalled probe in one half does not excuse the other" \
  "step 4 failed: the CSS half, every cell passed and the probe then stopped answering, which is the instrument rather than the seam. the resize half, neither a cell nor the probe; its own last words are above." \
  "$(summary 1 "$PROBE" 1 "$BOXES")"

# And the other direction: a producer that disagrees about its own boxes is the
# resize half's, and it used to be reported as a run that reached no verdict.
expect "only the resize half failing names only the resize half" \
  "step 4 failed: the resize half, neither a cell nor the probe; its own last words are above." \
  "$(summary 0 "$CLEAN" 1 "$BOXES")"

expect "both halves failing names both" \
  "step 4 failed: the CSS half, a cell is marked FAIL. the resize half, a cell is marked FAIL." \
  "$(summary 1 "$CELL" 1 "$CELL")"

# A long log is the SIGPIPE case that took a real cell failure to the catch-all
# when this was a pipeline. 200 KB is past where it was measured to start.
BIG="$(mktemp "$FIXTURES/XXXXXX")"
{ printf '%s\n' "$TABLE_HEAD" "$ROW_FAIL"
  head -c 200000 /dev/zero | tr '\0' 'x' | fold -w 100
} >"$BIG"
expect "a cell failure is still found under 200 KB of chatter" \
  "a cell is marked FAIL" \
  "$(half_verdict "$BIG")"

# THE PIPELINE'S STATUS IS THE PRODUCER'S, NOT `tee`'S, and nothing above says
# so. Each half runs as `spike.sh … | tee "$LOG"`, and `$?` after a pipeline is
# the *last* command's — `tee`, which succeeds whenever it can write. So
# `CSS=$?` instead of `CSS=${PIPESTATUS[0]}` leaves `FAILED` at 0 for a half
# that failed, and step 4 exits GREEN having measured a failure. Every case
# above passes with that mutation in place: they drive `half_verdict` and the
# summary directly and never run a pipeline.
#
# Read out of the file rather than run, because running a half means running
# Chromium. What it establishes is that the status each half is judged by is
# taken from the pipeline's first element.
for half in CSS RESIZE; do
  expect "the $half half's status comes from the producer, not tee" "yes" \
    "$(grep -qF "$half=\${PIPESTATUS[0]}" "$STEP4" &&
         echo yes || echo no)"
done

expect "the two halves are not judged by one status" "yes" \
  "$(test "$(grep -cF 'PIPESTATUS[0]}' "$STEP4")" = 2 &&
       echo yes || echo no)"

# Each half's log is its own, which is the other half of "a verdict about a
# half": pointed at one file, the resize run truncates the CSS run's and the
# failing half is diagnosed from the one that passed.
expect "the resize half writes its own engine log" "yes" \
  "$(grep -qF 'ENGINE_LOG=/tmp/domicile-spike-resize-engine.log' \
       "$STEP4" && echo yes || echo no)"

expect "the two halves keep separate logs" "yes" \
  "$(grep -qF 'tee "$CSS_LOG"' "$STEP4" &&
     grep -qF 'tee "$RESIZE_LOG"' "$STEP4" && echo yes || echo no)"

if [ "$FAILED_COUNT" -gt 0 ]; then
  echo "$FAILED_COUNT failed"
  exit 1
fi
echo "all ok"
