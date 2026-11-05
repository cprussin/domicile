#!/usr/bin/env bash
# Guards the native libinput seat and authorized-descriptor routing.
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
python3 - "$ROOT/packages/domicile-engine" <<'PY'
from pathlib import Path
import sys
import re

engine = Path(sys.argv[1])
added = "\n".join(
    line[1:]
    for patch in sorted((engine / "patches").glob("*.patch"))
    for line in patch.read_text().splitlines()
    if line.startswith("+") and not line.startswith("+++")
)
disabled = re.search(r"void LibInputEventConverter::OnDisabled\(\) \{([\s\S]*?)\n\}", added)
checks = {
    "disabling a pad clears its typing-guard button state": disabled is not None and "typing_guard_->RemoveDevice(input_device_.id);" in disabled.group(1),
    "button releases preserve the press remapping category": added.count("ButtonMap(),") >= 2,
    "late descriptor replies are canceled before conversion": "params.is_current.Run()" in added,
    "one seat belongs to the device factory": "std::unique_ptr<LibInputSeat> libinput_seat_;" in added,
    "the opener receives the factory's seat": "params.libinput_seat = libinput_seat_.get();" in added,
    "keyboards join the factory seat": "LibInputKeyboardEventConverter::Create(" in added,
    "pointer devices join the factory's seat": "*params.libinput_seat" in added,
}
failed = [name for name, satisfied in checks.items() if not satisfied]
for name in checks:
    print(f"{'FAIL' if name in failed else 'ok'}: {name}")
if failed:
    sys.exit(1)
PY
