#!/usr/bin/env bash
# Checks disabling a native device terminates its delivered scroll axes.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
python3 - "$root" <<'CHECK'
from pathlib import Path
import sys
engine = Path(sys.argv[1]) / "packages/domicile-engine"
added = "\n".join(line[1:] for patch in sorted((engine / "patches").glob("*.patch"))
                  for line in patch.read_text().splitlines()
                  if line.startswith("+") and not line.startswith("+++"))
checks = {
    "delivered axes are tracked independently": "active_scroll_axes_.Observe(" in added,
    "disabling a device forwards its remaining stops": "active_scroll_axes_.TakeStop()" in added and "LibInputEventConverter::OnDisabled()" in added,
    "active-axis behavior tests run in the DRM suite": "ActiveScrollAxesTest:3" in (engine / "scripts/drm-unit-tests.sh").read_text(),
    "native Wayland source tests run in the DRM suite": "WaylandPointerTest:19" in (engine / "scripts/drm-unit-tests.sh").read_text(),
}
for label, satisfied in checks.items():
    print(f"{'ok' if satisfied else 'FAIL'} {label}")
sys.exit(0 if all(checks.values()) else 1)
CHECK
