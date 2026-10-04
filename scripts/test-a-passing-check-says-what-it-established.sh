#!/usr/bin/env bash
# Checks `check.sh` prints a passing check's `PASS:` lines under its `ok`.
#
# `check.sh` keeps a check's log only on failure, so without this a pass gives
# no evidence of what it measured. Also checks that a failure keeps its whole
# log, a skip reads as a skip, and the tally format is unchanged.
#
# Two parts: `check.sh` against stub checks, and the css-and-resize check,
# whose guard output is quoted behind `  | ` and must relay its `PASS:` lines.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}

echo "check.sh, reporting a group"

# Use the `nix` group: it globs its scripts and installs nothing, so `bun`
# needs no stub. `verdict` is shared by every group.
REPO="$WORK/repo"
mkdir -p "$REPO/scripts"
cp "$ROOT/scripts/check.sh" "$REPO/scripts/"

standin() { # name, body
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$REPO/scripts/$1.sh"
  chmod +x "$REPO/scripts/$1.sh"
}

# A guard and its control, with noise around them. The second `PASS:` is
# indented, as when a guard quotes a run's output.
standin nix-1-says-what-it-established '
echo "starting the engine"
echo "PASS: the positive run found the window"
echo "a thousand lines of Chromium startup"
echo "  PASS: the control found nothing, as it must"'

# A typical check with `ok` lines and no `PASS:`.
standin nix-2-says-nothing '
echo "  ok    something this check asserts"
echo "all ok"'

# Longer than the 100-line failure summary, so only the kept log has its first
# line. Its `PASS:` must not be printed as a verdict.
standin nix-3-fails '
echo "PASS: an early run"
for n in $(seq 1 150); do echo "line $n"; done
exit 1'

# A skip after a `PASS:` line. Nothing it said may read as a pass.
standin nix-4-cannot-run '
echo "PASS: a step before the one that needed a card"
echo "  SKIP: no card here"
exit 77'

# Unset DOMICILE_CHECK_STRICT, which CI exports, so skips stay skips.
check() { # env assignments...
  env -u DOMICILE_CHECK_STRICT "$@" DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
    "$REPO/scripts/check.sh" nix >"$WORK/out" 2>&1
}

# Prints the indented lines under a check's verdict line.
under() { # check name
  awk -v name="$1" '
    found && !/^    / { exit }
    found { print }
    index($0, "  " name " ") == 1 { found = 1 }' "$WORK/out"
}

check

expect "a passing check's PASS: lines are printed under its ok" \
  "$(printf '    PASS: the positive run found the window\n    PASS: the control found nothing, as it must')" \
  "$(under nix-1-says-what-it-established)"

expect "its ok line is unchanged" "yes" \
  "$(grep -qE '^  nix-1-says-what-it-established +ok$' "$WORK/out" && echo yes || echo no)"

expect "a passing check with no PASS: line adds nothing" "" \
  "$(under nix-2-says-nothing)"

expect "and none of the rest of a passing check's log is printed" "no" \
  "$(grep -qE 'Chromium startup|all ok|something this check asserts' "$WORK/out" && echo yes || echo no)"

expect "a failing check is still FAILED, with no verdicts under it" "yes" \
  "$(grep -qE '^  nix-3-fails +FAILED$' "$WORK/out" && [ -z "$(under nix-3-fails)" ] &&
       echo yes || echo no)"

expect "and its whole log is kept" \
  "$(printf 'PASS: an early run\n'; seq 1 150 | sed 's/^/line /')" \
  "$(cat "$WORK/logs/domicile-check-logs/nix-3-fails.log")"

expect "a skip still reads as a skip, with no verdicts under it" "yes" \
  "$(grep -qE '^  nix-4-cannot-run +skipped \(no card here\)$' "$WORK/out" &&
     [ -z "$(under nix-4-cannot-run)" ] && echo yes || echo no)"

expect "the tally keeps its format" "yes" \
  "$(grep -qxF '== 2 passed, 1 failed, 1 skipped ==' "$WORK/out" &&
     grep -qxF '  skipped: nix-4-cannot-run — no card here' "$WORK/out" &&
       echo yes || echo no)"

check DOMICILE_CHECK_STRICT=1
expect "under DOMICILE_CHECK_STRICT a skip is still a failure" "yes" \
  "$(grep -qE '^  nix-4-cannot-run +FAILED \(no card here\)$' "$WORK/out" &&
     grep -qxF '== 2 passed, 2 failed, 0 skipped ==' "$WORK/out" &&
       echo yes || echo no)"

echo "the css-and-resize check relays its guard's verdicts"

# A repo with the real check and its library, a stub guard, and a stub
# `nix-shell` that runs the script it is given.
CSS="$WORK/css"
mkdir -p "$CSS/scripts/lib" "$CSS/packages/domicile-engine/scripts" \
  "$CSS/tree/out/Domicile" "$CSS/tree/tools/nix" "$CSS/bin"
cp "$ROOT/scripts/engine-guard-css-and-resize.sh" "$CSS/scripts/"
cp "$ROOT/scripts/lib/engine-guard.sh" "$CSS/scripts/lib/"
cp "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh" \
  "$CSS/packages/domicile-engine/scripts/"
: >"$CSS/tree/tools/nix/shell.nix"

# Verdicts followed by 400 lines, more than the 300 the check quotes, so
# quoting alone would lose them.
cat >"$CSS/packages/domicile-engine/scripts/guard-css-and-resize.sh" <<'GUARD'
#!/usr/bin/env bash
echo "PASS: css — the first run"
echo "PASS: backdrop-filter — the run nobody could see"
echo "PASS: resize — the last run"
seq 1 400
GUARD
printf '#!/bin/sh\necho /nix/store/00000000000000000000000000000000-nixpkgs\n' \
  >"$CSS/bin/nix"
printf '#!/bin/sh\nexec "$NIX_SHELL_RUN"\n' >"$CSS/bin/nix-shell"
chmod +x "$CSS/packages/domicile-engine/scripts/guard-css-and-resize.sh" \
  "$CSS/bin/nix" "$CSS/bin/nix-shell"

PATH="$CSS/bin:$PATH" DOMICILE_CHROMIUM="$CSS/tree" \
  "$CSS/scripts/engine-guard-css-and-resize.sh" >"$WORK/css-out" 2>&1
status=$?

expect "the check passed" "0" "$status"
expect "each of the guard's verdicts reaches check.sh unquoted" \
  "$(printf 'PASS: css — the first run\nPASS: backdrop-filter — the run nobody could see\nPASS: resize — the last run')" \
  "$(grep '^ *PASS: ' "$WORK/css-out")"

# A guard that exits 0 with no `PASS:` line fails the check.
printf '#!/usr/bin/env bash\nseq 1 400\n' \
  >"$CSS/packages/domicile-engine/scripts/guard-css-and-resize.sh"
PATH="$CSS/bin:$PATH" DOMICILE_CHROMIUM="$CSS/tree" \
  "$CSS/scripts/engine-guard-css-and-resize.sh" >/dev/null 2>&1
expect "a guard that passed stating nothing fails the check" "1" "$?"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
