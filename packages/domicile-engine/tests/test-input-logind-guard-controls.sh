#!/usr/bin/env bash
# Proves the logind source guard rejects broken coordinator routes.
set -euo pipefail
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ENGINE" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

engine = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="domicile-logind-controls-") as work:
    fixture = Path(work) / "packages/domicile-engine"
    for directory in ("src", "patches"):
        shutil.copytree(engine / directory, fixture / directory)
    for name in ("tests/test-input-comes-from-logind.sh", "scripts/drm-unit-tests.sh"):
        target = fixture / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(engine / name, target)
    guard = fixture / "tests/test-input-comes-from-logind.sh"
    positive = subprocess.run(["bash", str(guard)], capture_output=True, text=True)
    assert positive.returncode == 0, positive.stdout + positive.stderr
    print("ok: the coordinator satisfies the logind guard")

    sources = fixture / "src/ui/ozone/platform/drm/domicile"
    controls = (
        ("drm_input_opens.cc", "devices_->Resumed(pending.current.path)",
         "base::ScopedFD()", "a reopen consumes the resumed descriptor"),
        ("drm_input_opens.cc", "devices_->GiveBack(number);", "",
         "a device held from before is given back"),
        ("drm_input_opens.cc",
         "read_active_.Run(base::BindOnce(&DrmInputOpens::OnSessionActive,\n"
         "                                        weak_factory_.GetWeakPtr(), number));", "",
         "an inactive take asks the session"),
        ("drm_logind_input.cc", "params.is_current,", "{},",
         "a reopen consumes the resumed descriptor"),
        ("drm_input_opens.cc", "void DrmInputOpens::Begin(DeviceNumber number) {",
         'void DrmInputOpens::Begin(DeviceNumber number) {\n'
         '  base::ScopedFD fallback(open("/dev/input/event1", O_RDONLY));',
         "there is no fallback to open()"),
    )
    for filename, before, after, diagnostic in controls:
        path = sources / filename
        original = path.read_text()
        assert original.count(before) == 1, (filename, before)
        path.write_text(original.replace(before, after))
        result = subprocess.run(["bash", str(guard)], capture_output=True, text=True)
        path.write_text(original)
        assert result.returncode == 1, result.stdout + result.stderr
        assert f"FAIL  {diagnostic}" in result.stdout, result.stdout + result.stderr
        print(f"ok: the guard rejects {filename}: {before}")
PY
