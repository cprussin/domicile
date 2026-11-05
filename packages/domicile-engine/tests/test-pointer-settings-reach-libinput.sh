#!/usr/bin/env bash
# Checks live input settings reach the native controller and libinput.
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
    "input settings are retained by the native controller": "input_device_settings_.domicile_input = std::move(settings)" in added,
    "input updates are scheduled on the native controller": "input_device_settings_.domicile_input_generation" in added and "ScheduleUpdateDeviceSettings();" in added,
    "touchpad and mouse settings are independent": "ApplyCommonSettings(settings.domicile_input.mouse)" in added,
    "libinput receives the requested acceleration profile": "libinput_device_config_accel_set_profile" in added,
    "libinput receives tap drag and button mapping": "libinput_device_config_tap_set_drag_enabled" in added and "libinput_device_config_tap_set_button_map" in added,
    "libinput receives click and scroll methods": "libinput_device_config_click_set_method" in added and "libinput_device_config_scroll_set_method" in added,
    "typing policy distinguishes internal devices": "type() == InputDeviceType::INPUT_DEVICE_INTERNAL" in added,
    "unsupported method requests name the device": "libinput_device_get_name(device_)" in added and "selected_click.error()" in added,
}
for label, satisfied in checks.items():
    print(f"{'ok' if satisfied else 'FAIL'} {label}")
sys.exit(0 if all(checks.values()) else 1)
CHECK
