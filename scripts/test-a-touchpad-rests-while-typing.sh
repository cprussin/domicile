#!/usr/bin/env bash
# Checks a touchpad on a tty rests while a keyboard types, through
# `TypingGuard`.
#
# The rule lives in `src/ui/events/ozone/evdev/domicile/typing_guard.cc`. A
# patch hands the factory's guard to every converter, has keyboards report keys
# to it and the libinput converter ask it, and adds it to the build. Without
# any of these, a palm moves the pointer while typing and nothing fails.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
DOMICILE="$ENGINE/src/ui/events/ozone/evdev/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

for f in typing_guard.h typing_guard.cc typing_guard_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/events/ozone/evdev/domicile"
  fi
done

check() {
  if in_patches "$1"; then
    ok "$2"
  else
    fail "$2" "$3"
  fi
}

check 'converter->SetTypingGuard(&typing_guard_);' \
  "the factory hands its guard to every converter" \
  "no patch calls SetTypingGuard in InputDeviceFactoryEvdev::AttachInputDevice"
check 'typing_guard_->OnKey(key, down, timestamp);' \
  "a keyboard reports its keys" \
  "no patch calls OnKey from EventConverterEvdevImpl::OnKeyChange"
check 'typing_guard_->DropsMotion(Timestamp(evt))' \
  "the libinput converter drops motion and scrolls while typing" \
  "no patch calls DropsMotion in the libinput converter"
check 'typing_guard_->DropsButton(button, down, Timestamp(evt))' \
  "the libinput converter drops taps and clicks while typing" \
  "no patch calls DropsButton in the libinput converter"
check 'input_device_settings_.domicile_disable_while_typing);' \
  "the setting reaches the guard" \
  "no patch passes domicile_disable_while_typing to TypingGuard::SetEnabled"
check '"domicile/typing_guard.cc"' \
  "the guard is in the evdev component" \
  "no patch adds domicile/typing_guard.cc to ui/events/ozone/evdev/BUILD.gn"
# An unregistered test is not linked, and a `--gtest_filter` matching nothing
# exits zero.
check '"//ui/events/ozone/evdev/domicile/typing_guard_unittest.cc"' \
  "the unit test is in ozone_unittests" \
  "no patch adds typing_guard_unittest.cc to ui/ozone/platform/drm/BUILD.gn"

FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *TypingGuardTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'TypingGuardTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
