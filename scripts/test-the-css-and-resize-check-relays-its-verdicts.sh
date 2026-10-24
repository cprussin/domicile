#!/usr/bin/env bash
# Checks the css-and-resize check relays its guard's `PASS:` lines.
#
# The check quotes the guard's output behind `  | `, so without relaying them
# `check.sh` would print no evidence of what the guard established.
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
