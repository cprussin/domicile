#!/usr/bin/env bash
# Tests which run and which end `guard-css-and-resize.sh` blames.
#
# Covers `run_verdict` and the summary block, which turn three exit statuses
# and three logs into one line. Both are extracted from the real script, so
# moving them fails this test.
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

# Built from css_parity.cc's printf sites: the table shape (`:329`), verdict
# strings (`:370-380`, `:549-553`), latency lines (`:410`, `:476`) and resize
# refusals (`:566-584`).
TABLE_HEAD='property             pixels   differ   interior    worst in effect  verdict'
ROW_PASS='z-index               53200        0          0        0       yes  pass'
ROW_EDGES='transform             53200      285          0       84       yes  pass (edges only)'
ROW_FAIL='opacity               53200      412        118       97       yes  FAIL'
ROW_FAIL_BARE='mix-blend-mode        53200      412        118       97       yes  FAIL'
ROW_NOT_IN_EFFECT='opacity               53200        0          0        1        no  FAIL (the property is not in effect)'
# `ReportResize` prints a bare FAIL (`css_parity.cc:601`); `FAIL — …` is the
# iframe check's wording (`:549-553`). Both must be recognized.
RESIZE_FAIL='resize                53200      900        740      255  FAIL'
IFRAME_FAIL='transform             53200      900        740      255  FAIL — differs beyond its edges'
LATENCY_OK='latency over 60 samples, producer submit to the color appearing in the display compositor'"'"'s own output:'
LATENCY_DEAD='latency: the probe stopped answering'
# The other `latency:` line: the probe answered but the color never arrived
# (`css_parity.cc:459`).
LATENCY_NEVER='latency: FF00C853 never appeared after 200 draws'
RESIZE_BOXES='expected 180x130, the page and this disagree about its own boxes'
RESIZE_PRODUCER='the producer is rendering at 120x90, not 180x130'
NOT_RECONFIGURED='the page never reconfigured'
# The guard appends this to the backdrop-filter run's log when the page never
# confirms the filter. A page that ignored `?backdrop-filter=` would otherwise
# pass the plain table.
NEVER_FILTERED='the page never said it applied invert(1), so nothing above was filtered'

log() { local f; f="$(mktemp "$FIXTURES/XXXXXX")"; printf '%s\n' "$@" >"$f"; echo "$f"; }

# --- run_verdict, one run at a time ---------------------------------------

expect "a cell marked FAIL is a cell marked FAIL" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_FAIL" "$LATENCY_OK")")"

# FAIL as the last field. A pattern anchored on a trailing space would miss it.
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

# `FAIL($|[^E])` keeps the summary's own `FAILED` from matching as a cell's
# FAIL.
expect "the word FAILED is not a cell" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "step 4 failed: something" "FAILED")")"

# A failed cell outranks a failed probe. A stalled renderer exhausts the poll
# budget and also mismatches cells, and the latency phase runs after
# `css_passed_` is decided, so both often appear together.
expect "a failed cell outranks a failed probe" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_DEAD")")"

expect "a failed cell outranks a color that never arrived" \
  "a cell is marked FAIL" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_FAIL" "$LATENCY_NEVER")")"

# A run that fails for another reason still prints `latency over 60 samples…`.
# The pattern must be `^latency: `, or this reads as a stalled probe.
expect "a completed latency block is not a failed probe" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "off the window: the page does not fit" "$LATENCY_OK")")"

# The two `latency:` lines blame opposite ends. `never appeared` means the
# producer's pixels did not arrive, which is the seam.
expect "a color that never arrived is the seam, not the instrument" \
  "every cell passed and then a color the producer submitted never reached the screen, which is the seam" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$LATENCY_NEVER")")"

expect "a clean table and a dead probe is the instrument" \
  "every cell passed and the probe then stopped answering, which is the instrument rather than the seam" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES" "$LATENCY_DEAD")")"

# `transform` gets `pass (edges only)` under software rasterization on every
# run, so it must not count as a failure.
expect "edges-only is a pass, not a cell failure" \
  "neither a cell nor the probe; its own last words are above" \
  "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$ROW_EDGES")")"

for case in "$RESIZE_BOXES" "$RESIZE_PRODUCER" "$NOT_RECONFIGURED"; do
  expect "a producer refusal is not blamed on a cell or the probe" \
    "neither a cell nor the probe; its own last words are above" \
    "$(run_verdict "$(log "$TABLE_HEAD" "$ROW_PASS" "$case")")"
done

# The backdrop-filter run's refusal must reach the catch-all, since the table
# passed. Wording containing FAIL would be classified as a cell.
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

# Each run gets its own verdict: a stalled probe in the CSS run must not hide
# a seam failure in the resize run.
expect "a stalled probe in one run does not excuse another" \
  "step 4 failed: the CSS run, every cell passed and the probe then stopped answering, which is the instrument rather than the seam. the resize run, neither a cell nor the probe; its own last words are above." \
  "$(summary 1 "$PROBE" 0 "$CLEAN" 1 "$BOXES")"

# A producer that disagrees about its boxes is a resize-run failure.
expect "only the resize run failing names only the resize run" \
  "step 4 failed: the resize run, neither a cell nor the probe; its own last words are above." \
  "$(summary 0 "$CLEAN" 0 "$CLEAN" 1 "$BOXES")"

# Its table passed, so only the sentence the guard appended names it.
expect "only the backdrop-filter run failing names only the backdrop-filter run" \
  "step 4 failed: the backdrop-filter run, neither a cell nor the probe; its own last words are above." \
  "$(summary 0 "$CLEAN" 1 "$UNFILTERED" 0 "$CLEAN")"

expect "all three runs failing names all three" \
  "step 4 failed: the CSS run, a cell is marked FAIL. the backdrop-filter run, a cell is marked FAIL. the resize run, a cell is marked FAIL." \
  "$(summary 1 "$CELL" 1 "$CELL" 1 "$CELL")"

# A pass prints one line per run, because `check.sh` shows only a passing
# check's `PASS:` lines.
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

# A long log triggers SIGPIPE in a `grep | grep` pipeline under `pipefail`.
# 200 KB is past where that starts.
BIG="$(mktemp "$FIXTURES/XXXXXX")"
{ printf '%s\n' "$TABLE_HEAD" "$ROW_FAIL"
  head -c 200000 /dev/zero | tr '\0' 'x' | fold -w 100
} >"$BIG"
expect "a cell failure is still found under 200 KB of chatter" \
  "a cell is marked FAIL" \
  "$(run_verdict "$BIG")"

# Each run is `spike.sh … | tee "$LOG"`, and `$?` is `tee`'s status. The run's
# status must come from `${PIPESTATUS[0]}`, or a failed run passes. None of the
# cases above runs a pipeline, so check the source instead.
for run in CSS BACKDROP RESIZE; do
  expect "the $run run's status comes from the producer, not tee" "yes" \
    "$(grep -qF "$run=\${PIPESTATUS[0]}" "$STEP4" &&
         echo yes || echo no)"
done

expect "the three runs are not judged by one status" "yes" \
  "$(test "$(grep -cF 'PIPESTATUS[0]}' "$STEP4")" = 3 &&
       echo yes || echo no)"

# With a shared log, the resize run would truncate the CSS run's log.
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
# The filter is a query parameter on the CSS run's page. If the page ignores
# it, every cell passes against the plain table. The guard greps the engine log
# for the page's confirmation, so the guard and the page must agree on the
# parameter and the wording. No run can detect a mismatch.
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
