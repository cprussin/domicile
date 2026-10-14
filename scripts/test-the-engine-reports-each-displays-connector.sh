#!/usr/bin/env bash
# Checks the engine carries each display's DRM connector name ("HDMI-A-1")
# from the GPU process to the compositor.
#
# The compositor names a monitor with no EDID make, model or serial after its
# connector, as sway does (docs/DISPLAYS.md#monitor-names). Only the GPU
# process reads the connector, so the name crosses:
#
#   CreateDisplaySnapshot -> DisplaySnapshot's mojom -> DrmScreen ->
#   OzonePlatform::GetDomicileConnectors -> the broker's Display ->
#   DomicileConnectedDisplay
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
SRC="$ENGINE/src"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Whether a patch adds a line matching `pattern` to a file ending in `file`.
adds() {
  awk -v file="$1" -v pattern="$2" '
    /^diff --git a\// { in_file = (substr($3, length($3) - length(file) + 1) == file); next }
    in_file && /^\+/ && $0 ~ pattern { found = 1 }
    END { exit !found }
  ' "$PATCHES"/*.patch
}

check() {
  local name="$1" why="$2"; shift 2
  if "$@"; then ok "$name"; else fail "$name" "$why"; fi
}

check "the GPU process names each snapshot's connector" \
  "no patch to common/drm_util.cc calls set_domicile_connector" \
  adds "common/drm_util.cc" "set_domicile_connector[(]"
check "the snapshot's mojom carries the connector" \
  "no patch adds 'string domicile_connector;' to display_snapshot.mojom" \
  adds "display_snapshot.mojom" "string domicile_connector;"
check "the snapshot's mojom traits read the connector" \
  "no patch to display_snapshot_mojom_traits.cc reads it" \
  adds "display_snapshot_mojom_traits.cc" "ReadDomicileConnector[(]"
check "a snapshot's clone keeps its connector" \
  "no patch to display_snapshot.cc copies it in Clone()" \
  adds "display_snapshot.cc" "set_domicile_connector[(]"
check "the DRM platform lends its screen's connectors" \
  "no patch to ozone_platform_drm.cc overrides GetDomicileConnectors" \
  adds "ozone_platform_drm.cc" "GetDomicileConnectors[(][)]"

for file in \
  ui/ozone/platform/drm/domicile/connector_name.h \
  ui/ozone/platform/drm/domicile/connector_name.cc \
  ui/ozone/platform/drm/domicile/connector_name_unittest.cc; do
  check "$file exists" "no such file under src/" test -f "$SRC/$file"
done

# An unregistered file is not built, and a `--gtest_filter` matching nothing
# exits zero.
for file in connector_name.cc connector_name_unittest.cc; do
  check "domicile/$file is in BUILD.gn" \
    "no patch adds \"domicile/$file\" to ui/ozone/platform/drm/BUILD.gn" \
    adds "ui/ozone/platform/drm/BUILD.gn" "\"domicile/$file\","
done
check "the DRM suite list carries a floor for the suite" \
  "no 'DrmConnectorNameTest:<n>' in scripts/engine-drm-unit-tests.sh" \
  grep -qE "^ *DrmConnectorNameTest:[0-9]+$" "$ROOT/scripts/engine-drm-unit-tests.sh"

check "the browser sends the connector to the engine library" \
  "display_list.cc does not fill the mojom Display's connector" \
  grep -q "connectors" "$SRC/components/domicile/browser/display_list.cc"
check "the C ABI has connected_displays" \
  "domicile_engine.h declares no connected_displays callback" \
  grep -q "(\*connected_displays)" "$SRC/components/domicile/engine/domicile_engine.h"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
