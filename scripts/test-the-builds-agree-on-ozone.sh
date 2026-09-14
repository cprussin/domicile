#!/usr/bin/env bash
# Whether the two engine builds still name the same Ozone platforms, and still
# leave the default platform alone.
#
# There are two `gn gen` argument blocks in this repository and they are copies
# on purpose: `packages/domicile-engine/scripts/build.sh` is what every
# measurement was taken under, `.github/scripts/engine-release-build.sh` is what
# a person downloads, and the release script's own header says the ozone
# arguments are duplicated "because they are the same for a reason that could
# stop being true". Copies drift, and this one drifted before: the two `gn gen`
# calls disagreed about whether to run unconditionally, and CI went green having
# built with arguments nobody had edited.
#
# WHAT THE SECOND CHECK IS REALLY FOR. `ozone_platform_drm = true` is safe to
# add only because it does not change which platform a run gets by default.
# With `ozone_platform` unset, `generate_ozone_platform_list.py` never reorders
# -- it moves a platform to the front only when `--default` names one in the
# list -- so the order is `//ui/ozone/BUILD.gn`'s own, which appends headless
# before drm before wayland. Headless stays first and stays the default.
#
# Setting `ozone_platform = "drm"` in either block would flip that for every
# run on every machine, including the ones with no card node, and it would look
# like a one-word tidy-up. So the absence of that line is asserted, not assumed.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILDS="$ROOT/packages/domicile-engine/scripts/build.sh
$ROOT/.github/scripts/engine-release-build.sh"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# The positive first: an empty or renamed file must not pass vacuously.
for build in $BUILDS; do
  [ -f "$build" ] || { echo "no build script at $build" >&2; exit 1; }
  grep -q "^  use_ozone = true$" "$build" || {
    echo "$build has no 'use_ozone = true' line, so this script has stopped" >&2
    echo "reading its gn arguments and would pass every check below" >&2
    exit 1
  }
done

for platform in headless wayland drm; do
  missing=""
  for build in $BUILDS; do
    grep -q "^  ozone_platform_$platform = true$" "$build" ||
      missing="$missing $(basename "$build")"
  done
  if [ -z "$missing" ]; then
    ok "both builds compile the $platform platform"
  else
    fail "both builds compile the $platform platform" \
      "not named in:$missing"
  fi
done

# `ozone_auto_platforms = false` is what makes the list above exhaustive. With
# it true, is_linux turns on x11 and wayland regardless of what is written here.
for build in $BUILDS; do
  if grep -q "^  ozone_auto_platforms = false$" "$build"; then
    ok "$(basename "$build") chooses its platforms by hand"
  else
    fail "$(basename "$build") chooses its platforms by hand" \
      "no 'ozone_auto_platforms = false', so gn picks platforms this list does not name"
  fi
done

for build in $BUILDS; do
  if grep -qE "^[[:space:]]*ozone_platform = " "$build"; then
    fail "$(basename "$build") leaves the default platform alone" \
      "it sets ozone_platform, which moves that platform to the front of the generated list and makes it the default for every run"
  else
    ok "$(basename "$build") leaves the default platform alone"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
