#!/usr/bin/env bash
# Which end step 4 blames, and which of its runs it blames it on.
#
# The unit is `run_verdict` and the summary block in `guard-css-and-resize.sh` — what
# turns three exit statuses and three logs into the one line the workflow prints.
#
# It exists because three versions of that sentence lived in the workflow step
# instead, greping over every run at once, and every one of them named the
# wrong end: a resize that disagreed about its own boxes reported as "never got
# as far as a verdict"; a seam failure in the resize run reported as "the
# instrument, not the seam" because the CSS run's probe had also stalled; and
# `grep -v … | grep -q …` losing to SIGPIPE under `pipefail` on a long log and
# sending a real cell failure to the catch-all. None of them was ever run.
#
# Both pieces are taken out of the real script rather than copied, so a rewrite
# that moves them fails here loudly instead of leaving this passing against a
# version nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEP4="$ROOT/packages/domicile-engine/scripts/guard-css-and-resize.sh"
PARITY_PAGE="$ROOT/packages/domicile-engine/scripts/spike-css-page.html"

# From `run_verdict() {` to the `}` in column 0 that closes it.
VERDICT="$(awk '/^run_verdict\(\) \{/,/^\}$/' "$STEP4")"
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
# here because both are strings this has to recognize.
RESIZE_FAIL='resize                53200      900        740      255  FAIL'
IFRAME_FAIL='transform             53200      900        740      255  FAIL — differs beyond its edges'
LATENCY_OK='latency over 60 samples, producer submit to the color appearing in the display compositor'"'"'s own output:'
LATENCY_DEAD='latency: the probe stopped answering'
# The OTHER `latency:` line, and the opposite end: the probe answered every
# time and the color never arrived. `css_parity.cc:459`.
LATENCY_NEVER='latency: FF00C853 never appeared after 200 draws'
RESIZE_BOXES='expected 180x130, the page and this disagree about its own boxes'
RESIZE_PRODUCER='the producer is rendering at 120x90, not 180x130'
NOT_RECONFIGURED='the page never reconfigured'
# The one line in a run's log that the producer did not write. The
# backdrop-filter run fails on the page's own silence as well as on the
# producer's status — a page that ignored `?backdrop-filter=` measures the
# plain table and passes it — and the guard appends this to that run's log so
# the verdict below quotes it rather than inventing a sentence for it.
NEVER_FILTERED='the page never said it applied invert(1), so nothing above was filtered'

log() { local f; f="$(mktemp "$FIXTURES/XXXXXX")"; printf '%s\n' "$@" >"$f"; echo "$f"; }

# --- run_verdict, one run at a time ---------------------------------------

expect "a cell marked FAIL is a cell marked FAIL" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_FAIL" "$LATENCY_OK")")"

# The verdict column's last field, with nothing after it. A pattern anchored on
# a trailing space would miss this and blame the wrong end.
expect "a bare FAIL at the end of a row counts" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL_BARE")")"

expect "FAIL with a reason in brackets counts" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_NOT_IN_EFFECT")")"

expect "the resize run's bare FAIL counts" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$RESIZE_FAIL")")"

expect "the iframe check's FAIL wording counts" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$IFRAME_FAIL")")"

# THE CASE THE `[^E]` IS FOR. This function feeds a line that says FAILED, and
# a run of it against its own output must not answer its own question.
expect "the word FAILED is not a cell" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "step 4 failed: something" "FAILED")")"

# THE CASE THAT PINS THE ORDER, and the one no fixture had: both a failed cell
# and a failed probe, which is the realistic log rather than a contrived one.
# `css_passed_` is decided before the latency phase and the phase runs anyway,
# and a renderer stalled enough to exhaust the poll budget is exactly what also
# mismatches a cell. Asked probe-first, this says the instrument about a
# property that really did behave differently.
expect "a failed cell outranks a failed probe" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_DEAD")")"

# And the other end of the same pair.
expect "a failed cell outranks a color that never arrived" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_NEVER")")"

# THE CASE THAT PINS THE ANCHOR. A run that fails for its own reason and still
# completes its latency phase carries `latency over 60 samples…`, which is not
# a failure at all. A grep for `latency` rather than `^latency: ` reads this as
# a stalled probe and blames the instrument for a page that did not fit.
expect "a completed latency block is not a failed probe" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "off the window: the page does not fit" "$LATENCY_OK")")"

# THE TWO `latency:` LINES ARE OPPOSITE ENDS. One grep for the prefix called
# both the instrument; `never appeared` is the producer's pixels not arriving,
# which is the seam and the worst thing this script can find.
expect "a color that never arrived is the seam, not the instrument" \
  "every cell passed and then a color the producer submitted never reached the screen, which is the seam" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_NEVER")")"

expect "a clean table and a dead probe is the instrument" \
  "every cell passed and the probe then stopped answering, which is the instrument rather than the seam" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES" "$LATENCY_DEAD")")"

# `pass (edges only)` is what `transform` gets under software rasterization on
# every run. A pattern matching it as a failure would fail every green run.
expect "edges-only is a pass, not a cell failure" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES")")"

for case in "$RESIZE_BOXES" "$RESIZE_PRODUCER" "$NOT_RECONFIGURED"; do
  expect "a producer refusal is not blamed on a cell or the probe" \
    "neither a cell nor the probe; its own last words are above" \
    "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$case")")"
done

# THE BACKDROP-FILTER RUN'S OWN REFUSAL, which is the one line in a log the
# producer did not write. It has to reach the catch-all: it is neither a cell
# nor the probe, and the sentence it prints is the one worth quoting. A wording
# carrying the word FAIL would be classified as a cell and send the reader at
# the table, which passed.
expect "a run that was never filtered is not blamed on a cell or the probe" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_OK" "$NEVER_FILTERED")")"

# --- the summary, all three runs at once -----------------------------------

summary() { # $1 CSS status, $2 CSS log, $3 backdrop status, $4 backdrop log,
            # $5 resize status, $6 resize log
  (
    FAILED=1
    CSS="$1"; CSS_LOG="$2"
    BACKDROP="$3"; BACKDROP_LOG="$4"
    RESIZE="$5"; RESIZE_LOG="$6"
    eval "$SUMMARY" 2>&1 >/dev/null
  )
}

CLEAN="$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_OK")"
CELL="$(log "$TABLE_HEAD" "$ROW_FAIL")"
PROBE="$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_DEAD")"
BOXES="$(log "$TABLE_HEAD" "$ROW_PASS" "$RESIZE_PRODUCER")"
UNFILTERED="$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_OK" "$NEVER_FILTERED")"

expect "only the CSS run failing names only the CSS run" \
  "step 4 failed: the CSS run, a cell is marked FAIL." \
  "$(summary 1 "$CELL" 0 "$CLEAN" 0 "$CLEAN")"

# THE DEFECT THIS WHOLE FILE IS FOR. The resize run failed at the seam and the
# CSS run's probe stalled; the version that greped both at once announced the
# instrument and sent the reader away from the failure.
expect "a stalled probe in one run does not excuse another" \
  "step 4 failed: the CSS run, every cell passed and the probe then stopped answering, which is the instrument rather than the seam. the resize run, neither a cell nor the probe; its own last words are above." \
  "$(summary 1 "$PROBE" 0 "$CLEAN" 1 "$BOXES")"

# And the other direction: a producer that disagrees about its own boxes is the
# resize run's, and it used to be reported as a run that reached no verdict.
expect "only the resize run failing names only the resize run" \
  "step 4 failed: the resize run, neither a cell nor the probe; its own last words are above." \
  "$(summary 0 "$CLEAN" 0 "$CLEAN" 1 "$BOXES")"

# The run whose table passed and whose page was never asked anything. Nothing
# in it is a cell failure, so the only thing that names it is the sentence the
# guard appended to it.
expect "only the backdrop-filter run failing names only the backdrop-filter run" \
  "step 4 failed: the backdrop-filter run, neither a cell nor the probe; its own last words are above." \
  "$(summary 0 "$CLEAN" 1 "$UNFILTERED" 0 "$CLEAN")"

expect "all three runs failing names all three" \
  "step 4 failed: the CSS run, a cell is marked FAIL. the backdrop-filter run, a cell is marked FAIL. the resize run, a cell is marked FAIL." \
  "$(summary 1 "$CELL" 1 "$CELL" 1 "$CELL")"

# AND WHAT A PASS SAYS, one line per run, because a pass is only ever read from
# these: `check.sh` prints a passing check's `PASS:` lines and nothing else of
# its log. PR #586's backdrop-filter run went green with no line saying it had
# happened at all.
said_on_a_pass() { # the summary's stdout, with every run passing
  (
    FAILED=0
    BACKDROP_FILTER='invert(1)'
    RESIZE_FROM=120x90; RESIZE_TO=180x130
    eval "$SUMMARY" 2>/dev/null
  )
}
expect "a pass says what each of the three runs established" \
  "PASS: css — each property on an <app> matches the same property on an ordinary <div>, interior pixel for interior pixel
PASS: backdrop-filter — so does each under invert(1), which the page said it applied
PASS: resize — the <app> went from 120x90 to 180x130, the producer followed it, and it still matches a <div>" \
  "$(said_on_a_pass | grep '^PASS: ')"

# A long log is the SIGPIPE case that took a real cell failure to the catch-all
# when this was a pipeline. 200 KB is past where it was measured to start.
BIG="$(mktemp "$FIXTURES/XXXXXX")"
{ printf '%s\n' "$TABLE_HEAD" "$ROW_FAIL"
  head -c 200000 /dev/zero | tr '\0' 'x' | fold -w 100
} >"$BIG"
expect "a cell failure is still found under 200 KB of chatter" \
  "a cell is marked FAIL" \
  "$(run_verdict "$BIG")"

# THE PIPELINE'S STATUS IS THE PRODUCER'S, NOT `tee`'S, and nothing above says
# so. Each run is `spike.sh … | tee "$LOG"`, and `$?` after a pipeline is
# the *last* command's — `tee`, which succeeds whenever it can write. So
# `CSS=$?` instead of `CSS=${PIPESTATUS[0]}` leaves `FAILED` at 0 for a run
# that failed, and step 4 exits GREEN having measured a failure. Every case
# above passes with that mutation in place: they drive `run_verdict` and the
# summary directly and never run a pipeline.
#
# Read out of the file rather than run, because running one means running
# Chromium. What it establishes is that the status each run is judged by is
# taken from the pipeline's first element.
for run in CSS BACKDROP RESIZE; do
  expect "the $run run's status comes from the producer, not tee" "yes" \
    "$(grep -qF "$run=\${PIPESTATUS[0]}" "$STEP4" &&
         echo yes || echo no)"
done

expect "the three runs are not judged by one status" "yes" \
  "$(test "$(grep -cF 'PIPESTATUS[0]}' "$STEP4")" = 3 &&
       echo yes || echo no)"

# Each run's log is its own, which is the other half of "a verdict about a
# run": pointed at one file, the resize run truncates the CSS run's and the
# failing one is diagnosed from the one that passed.
expect "the resize run writes its own engine log" "yes" \
  "$(grep -qF 'ENGINE_LOG=/tmp/domicile-spike-resize-engine.log' \
       "$STEP4" && echo yes || echo no)"

expect "the backdrop-filter run writes its own engine log" "yes" \
  "$(grep -qF 'BACKDROP_ENGINE_LOG=/tmp/domicile-spike-backdrop-engine.log' \
       "$STEP4" &&
     grep -qF 'ENGINE_LOG="$BACKDROP_ENGINE_LOG"' "$STEP4" &&
       echo yes || echo no)"

expect "the three runs keep separate logs" "yes" \
  "$(grep -qF 'tee "$CSS_LOG"' "$STEP4" &&
     grep -qF 'tee "$BACKDROP_LOG"' "$STEP4" &&
     grep -qF 'tee "$RESIZE_LOG"' "$STEP4" && echo yes || echo no)"

# --- the backdrop-filter run and the page it asks ---------------------------
#
# THE ONE RUN THAT CAN PASS HAVING MEASURED THE OTHER TWO'S PAGE. The filter is
# a query parameter on the same page the CSS run uses, so a parameter the page
# does not read is not a failure anywhere: the page lays out the plain table,
# every cell passes, and the run reports parity for a filter nothing applied.
# The guard closes that by making the page say what it did and greping its
# engine log for it — and these two are the agreement that grep depends on,
# which is the one part of it no run can check, since a run with the two out of
# step is exactly the run that reports nothing wrong.
[ -f "$PARITY_PAGE" ] || {
  echo "no page at $PARITY_PAGE — the parity measurement moved. Fix this test with it." >&2
  exit 1
}

expect "the backdrop-filter run asks the page for the filter it names" "yes" \
  "$(grep -qF 'backdrop-filter=$BACKDROP_FILTER' "$STEP4" &&
     grep -qF "'backdrop-filter'" "$PARITY_PAGE" && echo yes || echo no)"

expect "the page announces the filter in the words the run greps for" "yes" \
  "$(grep -qF 'domicile: backdrop-filter ' "$STEP4" &&
     grep -qF 'domicile: backdrop-filter ' "$PARITY_PAGE" &&
       echo yes || echo no)"

if [ "$FAILED_COUNT" -gt 0 ]; then
  echo "$FAILED_COUNT failed"
  exit 1
fi
echo "all ok"
