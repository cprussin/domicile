#!/usr/bin/env bash
# Tests which results `guard-pdf-after-hiding.sh` passes, and that the series
# un-throttles a shown frame's children.
#
# Runs the guard's own verdict block, not a copy. Key cases:
#
#   - A page drawn as before, or a little less, passes.
#   - A page that lost more than half its pixels fails, naming patch 0214.
#   - A page that never drew, or a <webview> that never attached, fails.
#   - A page whose <webview> never said it was hidden fails.
#   - Only a frame with the viewer's gray around the page is the page: the
#     viewer's first frame is all white.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
GUARD="$ENGINE/scripts/guard-pdf-after-hiding.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

verdict() { # $1 MEASURED
  (
    # shellcheck disable=SC2034 # read by the eval below
    MEASURED="$1"
    eval "$BLOCK"
    case "$FAILURE" in
    "") echo pass ;;
    *"patch 0214"*) echo "fail: 0214" ;;
    *"never said it was hidden"*) echo "fail: hidden" ;;
    *never*) echo "fail: never" ;;
    *) echo "fail: $FAILURE" ;;
    esac
  )
}

expect "a page drawn again passes" "pass" "$(verdict 'before=105108 after=105108')"
expect "a page drawn at half passes" "pass" "$(verdict 'before=100 after=50')"
expect "a blank page fails" "fail: 0214" "$(verdict 'before=105108 after=0')"
expect "a page under half fails" "fail: 0214" "$(verdict 'before=100 after=49')"
expect "a page that never drew fails" "fail: never" "$(verdict 'before=0')"
expect "a webview that never attached fails" "fail: never" "$(verdict '')"
expect "an engine with no port fails" "fail: never" "$(verdict 'no-port')"
expect "a webview never hidden fails" "fail: hidden" "$(verdict 'hidden=never')"

# The measurement's own reading of a frame.
is_page() { # $1 white pixels, $2 all pixels
  python3 -I - "$ENGINE/scripts" "$1" "$2" <<'PY'
import importlib.util, sys
scripts, white, total = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sys.path.insert(0, scripts)
spec = importlib.util.spec_from_file_location(
    "guard_pdf_after_hiding", scripts + "/guard-pdf-after-hiding.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
print("page" if guard.is_page(white, total) else "not")
PY
}
expect "the page on the viewer's gray is the page" "page" "$(is_page 105108 800000)"
expect "an all-white frame is not the page" "not" "$(is_page 800000 800000)"
expect "a mostly white frame is not the page" "not" "$(is_page 700000 800000)"
expect "a frame with a few white pixels is not the page" "not" "$(is_page 100 800000)"

PATCH="$(grep -al '^+++ b/third_party/blink/renderer/core/frame/local_frame.cc' "$ENGINE"/patches/*.patch)"
# shellcheck disable=SC2086 # one path per patch
if [ -n "$PATCH" ] &&
  grep -aqF '+        frame_view->IsDisplayLockThrottled(), /*recurse=*/true);' $PATCH; then
  printf '  ok    %s\n' "a shown frame un-throttles its children"
else
  printf '  FAIL  %s\n' "no patch un-throttles a shown frame's children"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ] || exit 1
