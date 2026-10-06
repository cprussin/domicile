#!/usr/bin/env bash
# Checks that the DRM platform gets evdev descriptors from logind's
# `Session.TakeDevice`.
#
# On a tty, a plain `open()` of `/dev/input/eventN` fails: logind's uaccess
# rules grant the session user access to GPUs but not to keyboards. Adding
# the user to the `input` group would give every process they run a permanent
# keyboard grant.
#
# Guards two failures a green build hides:
#   - the `InputDeviceOpener` is not installed, so the desktop gets no input
#   - a fallback to `open()` is added, which brings the same failure back
#
# Reads `src/` and `patches/` instead of a Chromium tree, so it is cheap
# enough to run on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
DOMICILE="$ENGINE/src/ui/ozone/platform/drm/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Added lines only (`^+`), so context lines quoting upstream do not match.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# Domicile-owned files live in `src/`, not in a patch.
for f in drm_input_devices.h drm_input_devices.cc drm_input_devices_unittest.cc \
         drm_input_controller_unittest.cc \
         drm_logind_input.h drm_logind_input.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/ozone/platform/drm/domicile"
  fi
done

sources="$(cat "$DOMICILE"/drm_logind_input.cc "$DOMICILE"/drm_input_devices.cc 2>/dev/null || true)"
in_sources() { case "$sources" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# logind's descriptor-passing calls. logind refuses `TakeDevice` before
# `TakeControl`. It also waits for `PauseDeviceComplete` before switching VTs,
# so without it every console switch stalls until logind's timeout.
for call in TakeControl TakeDevice PauseDeviceComplete ReleaseControl; do
  if in_sources "\"$call\""; then
    ok "the session's $call is called"
  else
    fail "the session's $call is called" "no \"$call\" in the domicile sources"
  fi
done

for signal in PauseDevice ResumeDevice; do
  if in_sources "kSignal$signal"; then
    ok "the $signal signal is followed"
  else
    fail "the $signal signal is followed" "no kSignal$signal in the domicile sources"
  fi
done

# A resume must re-add the device through the factory. logind revokes the
# paused descriptor, the converter stops on the resulting `ENODEV`, and only
# `InputDeviceFactoryEvdev::AttachInputDevice` calls `Start()` again. Swapping
# the descriptor alone leaves input dead after the first console switch.
if in_sources 'reopen_.Run('; then
  ok "a resume puts the device back through the factory"
else
  fail "a resume puts the device back through the factory" \
    "nothing runs the reopen callback; a dup2 alone cannot re-arm the watch"
fi

if in_patches 'SetDeviceReopener'; then
  ok "the factory hands the opener a way back in"
else
  fail "the factory hands the opener a way back in" \
    "no patch gives InputDeviceOpener a reopen callback"
fi

# A `base::RepeatingCallback` member makes `InputDeviceOpener` "complex" to the
# chromium-style clang plugin, which then requires an out-of-line constructor
# and destructor. The build uses `-Werror`, so inlining either fails the
# build.
if in_patches '"input_device_opener.cc",'; then
  ok "the opener's constructor and destructor have a translation unit"
else
  fail "the opener's constructor and destructor have a translation unit" \
    "input_device_opener.cc is not in the evdev target; chromium-style will refuse the header"
fi

if in_patches 'factory->RemoveInputDevice(path);'; then
  ok "the reopen closes the device before opening it again"
else
  fail "the reopen closes the device before opening it again" \
    "no patch calls RemoveInputDevice ahead of AddInputDevice"
fi

# logind refuses `TakeDevice` for a device the session already holds, so the
# reopen must use the descriptor from `ResumeDevice` before asking for
# another.
opener_body="$(awk '/^base::ScopedFD DrmLogindInput::OpenDeviceFd/,/^}/' \
  "$DOMICILE/drm_logind_input.cc" 2>/dev/null || true)"
resumed_at="$(printf '%s\n' "$opener_body" | grep -n 'Resumed(' | head -1 | cut -d: -f1)"
take_at="$(printf '%s\n' "$opener_body" | grep -n 'take_device(' | head -1 | cut -d: -f1)"
if [ -n "$resumed_at" ] && [ -n "$take_at" ] && [ "$resumed_at" -lt "$take_at" ]; then
  ok "a reopen consumes the resumed descriptor instead of taking the device again"
else
  fail "a reopen consumes the resumed descriptor instead of taking the device again" \
    "OpenDeviceFd does not consult the resumed descriptor before calling TakeDevice"
fi

# On a seat with VTs, logind sends a "force" pause with descriptors already
# revoked and no `ResumeDevice` after it. The only way back is `ReleaseDevice`
# then `TakeDevice`; logind refuses `TakeDevice` for a device still held.
giveback_at="$(printf '%s\n' "$opener_body" | grep -n 'GiveBack(' | head -1 | cut -d: -f1)"
if [ -n "$giveback_at" ] && [ -n "$take_at" ] && [ "$giveback_at" -lt "$take_at" ]; then
  ok "a device held from before is given back before it is taken again"
else
  fail "a device held from before is given back before it is taken again" \
    "OpenDeviceFd calls TakeDevice without releasing first; logind refuses it"
fi

# The `b` in `TakeDevice`'s `hb` reply is true when the session is inactive,
# and logind revokes the descriptor in that case. Ignoring it means using a
# dead descriptor.
if in_sources 'PopBool(&inactive)'; then
  ok "the liveness in TakeDevice's reply is read"
else
  fail "the liveness in TakeDevice's reply is read" \
    "nothing pops the boolean beside the descriptor; the fd may be revoked"
fi

# Recovery follows the session's `Active` property, since a seat with VTs
# never sends `ResumeDevice` after a force pause.
for followed in kPropertiesChanged kActive Reclaim; do
  if in_sources "$followed"; then
    ok "the session's activation is followed ($followed)"
  else
    fail "the session's activation is followed ($followed)" \
      "no $followed in the domicile sources; a revoked device would never come back"
  fi
done

# No fallback to `open()`: it cannot work on a tty, so a missing or refusing
# logind session must fail loudly.
if in_sources 'open('; then
  fail "there is no fallback to open()" \
    "drm_logind_input.cc calls open(); the whole point is that it cannot work"
else
  ok "there is no fallback to open()"
fi

# `InputDeviceFactoryEvdev` takes an `InputDeviceOpener` as a constructor
# argument. Check that `ozone_platform_drm.cc` passes the logind one.
if in_patches 'std::make_unique<DrmLogindInput>()'; then
  ok "the DRM platform installs the logind opener"
else
  fail "the DRM platform installs the logind opener" \
    "no patch constructs DrmLogindInput"
fi

if in_patches 'virtual base::ScopedFD OpenDeviceFd'; then
  ok "the descriptor is the one thing the opener overrides"
else
  fail "the descriptor is the one thing the opener overrides" \
    "no patch adds InputDeviceOpenerEvdev::OpenDeviceFd"
fi

# Unregistered, the test does not link, and a `--gtest_filter` matching
# nothing exits zero.
if in_patches '"domicile/drm_input_devices_unittest.cc"'; then
  ok "the unit test is in the gbm_unittests target"
else
  fail "the unit test is in the gbm_unittests target" \
    "no patch adds domicile/drm_input_devices_unittest.cc to BUILD.gn"
fi

# `scripts/engine-drm-unit-tests.sh` holds the minimum test count per suite,
# and both engine jobs run it.
FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *DrmInputDevicesTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'DrmInputDevicesTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

# `InputDeviceFactoryEvdev::DetachInputDevice` calls `OnInputDeviceRemoved`
# on the evdev thread. The controller must post to its own UI sequence; posting
# a UI-bound WeakPtr task on the evdev thread fails a sequence DCHECK when a
# console switch removes every device.
if in_patches "remove_device_ = base::BindPostTaskToCurrentDefault("; then
  ok "a device removal is posted to the input controller's own sequence"
else
  fail "a device removal is posted to the input controller's own sequence" \
    "InputControllerEvdev::OnInputDeviceRemoved runs on the evdev thread and posts a UI-bound WeakPtr task there"
fi

if in_patches '"domicile/drm_input_controller_unittest.cc"'; then
  ok "the controller's unit test is in the gbm_unittests target"
else
  fail "the controller's unit test is in the gbm_unittests target" \
    "no patch adds domicile/drm_input_controller_unittest.cc to BUILD.gn"
fi

if grep -qE "^ *DrmInputControllerTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the controller's suite"
else
  fail "the DRM suite list carries a floor for the controller's suite" \
    "no 'DrmInputControllerTest:<n>' in scripts/engine-drm-unit-tests.sh"
fi

# An inactive `TakeDevice` reply can be a startup race, not a background
# console. `Reclaim` runs only on a `PropertiesChanged` for `Active`, which an
# already-active session never sends. So check the session's state instead of
# waiting for a change.
if in_sources "SessionIsActive()" && [ "$(grep -c 'SessionIsActive()' "$DOMICILE/drm_logind_input.cc")" -ge 3 ]; then
  ok "an inactive take asks the session rather than waiting for an edge"
else
  fail "an inactive take asks the session rather than waiting for an edge" \
    "OpenDeviceFd parks an inactive device and waits for PropertiesChanged, which never comes for a session that was already active"
fi

# Answer `ResumeDevice` from `names_`, not the held table. `GiveBack` removes
# a device from the held table before the re-take, and a resume arriving in
# that window would otherwise drop a live descriptor. Only an unplug removes a
# device from `names_`.
if grep -q 'names_.find(number)' "$DOMICILE/drm_input_devices.cc" &&
  ! grep -q 'const auto taken = devices_.find(number);'     <(sed -n '/^bool DrmTakenDevices::Resume/,/^}/p' "$DOMICILE/drm_input_devices.cc"); then
  ok "a resume is answered from the names rather than from the held table"
else
  fail "a resume is answered from the names rather than from the held table"     "Resume consults devices_, so a resume arriving between a GiveBack and its TakeDevice throws a live descriptor away"
fi

# Check only the unplug arm of the "gone" branch. A release this session
# requested also gets a "gone", and that one must not forget the device. The
# range starts at the comment naming the unplug case.
if grep -q 'names_.erase(number)'   <(sed -n '/Unplugged: forget the device and its name/,/kNothingToSay;/p' "$DOMICILE/drm_input_devices.cc"); then
  ok "a device whose node is gone is forgotten by name too"
else
  fail "a device whose node is gone is forgotten by name too"     "a resume for an unplugged device would be answered with a path that is not there any more"
fi

# `ReleaseDevice` makes logind send `PauseDevice(..., "gone")`, which arrives
# after the following `TakeDevice`. Read as an unplug, it forgets a device the
# session holds, and logind's later `ResumeDevice` calls are refused, leaving
# no input. `GiveBack` records the expected "gone" in `released_`.
if grep -q 'released_' "$DOMICILE/drm_input_devices.cc" &&
  grep -q 'released_\[number\] += 1' "$DOMICILE/drm_input_devices.cc"; then
  ok "a release this session asked for expects the gone it will be answered with"
else
  fail "a release this session asked for expects the gone it will be answered with" \
    "GiveBack does not record the gone logind owes it, so the echo is read as \
the node going away and the device is forgotten while logind still holds it"
fi

# Each D-Bus connection needs a dedicated thread. `DrmLogindInput` makes
# blocking calls, since `OpenInputDevice` must return a descriptor, and no
# other bus on its thread can read its socket meanwhile. During a console
# switch it makes about three blocking calls per device. If `DrmVtSwitcher`
# shared that thread, its `PropertiesChanged` would arrive late, the GPU
# process would keep committing to a card it no longer owns, and
# `PageFlipWatchdog` would crash it.
for bus in drm_logind_input drm_vt_switcher drm_sleep; do
  if grep -q 'SingleThreadTaskRunnerThreadMode::DEDICATED' "$DOMICILE/$bus.cc"; then
    ok "$bus's bus has a thread of its own"
  else
    fail "$bus's bus has a thread of its own" \
      "$bus.cc does not ask for DEDICATED, so its socket is pumped on a thread \
another bus can block for the length of a logind round trip"
  fi
done

if grep -l 'SingleThreadTaskRunnerThreadMode::SHARED' "$DOMICILE"/*.cc >/dev/null 2>&1; then
  fail "no bus in this platform shares a thread" \
    "$(grep -l 'ThreadMode::SHARED' "$DOMICILE"/*.cc | tr '\n' ' ')asks for SHARED"
else
  ok "no bus in this platform shares a thread"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
