#!/usr/bin/env bash
# Keeps the live input configuration route in the engine ABI and Mojo broker.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
engine="$root/packages/domicile-engine"
python3 - "$engine" <<'CHECK'
from pathlib import Path
import sys
engine = Path(sys.argv[1])
required = {
    "src/components/domicile/engine/domicile_engine.h": "domicile_input_configure(",
    "src/components/domicile/engine/domicile_engine.cc": "broker_->ConfigureInput(",
    "src/components/domicile/mojom/frame_sink_broker.mojom": "ConfigureInput(string config)",
    "src/content/browser/domicile/domicile_frame_sink_broker.cc": "SetDomicileInputConfig(",
}
for name, contract in required.items():
    assert contract in (engine / name).read_text(), f"{name}: missing live input route {contract}"
print("live input configuration reaches the engine's hardware platform")
CHECK
