#!/usr/bin/env bash
# Whether the DRM platform's evdev descriptors come from logind.
#
# On a tty the bare `open("/dev/input/eventN", O_RDWR)` in
# `InputDeviceOpenerEvdev::OpenInputDevice` is `Permission denied`: logind's
# `70-uaccess.rules` ACLs `card*` and `renderD*` and, among input devices,
# only `ID_INPUT_JOYSTICK`. A keyboard keeps its group-owned mode and the
# session user gets no ACL entry on it. Every other Wayland compositor takes
# the descriptor from `org.freedesktop.login1.Session.TakeDevice` instead; the
# alternative is putting the user in the `input` group, which is a standing
# keyboard grant to every process that user runs and is revoked on nothing.
#
# THE TWO HALVES THIS GUARDS ARE THE TWO THAT CAN ROT SILENTLY. The seam
# (`InputDeviceOpener`, injected into `InputDeviceFactoryEvdev` by design) can
# be left unplugged and the build is still green -- the desktop just comes up
# deaf, which is exactly the failure this change exists to remove. And a
# fallback to `open()` added later "so it works in more places" would put the
# deafness back while looking like robustness.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads `src/`
# and `patches/`, which is what makes it cheap enough to run in the shell group
# on every push rather than only when the fork is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
DOMICILE="$ENGINE/src/ui/ozone/platform/drm/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Added lines only (`^+`), so a patch that merely quotes upstream in context
# cannot satisfy this.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# The Domicile-owned half lives in `src/`, never in a patch: a file is in one
# or the other and never both.
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

# The four calls that make up logind's fd-passing protocol. `TakeControl`
# before anything else (logind refuses `TakeDevice` to a session that does not
# hold control), `TakeDevice` per device, and the pause half, which is not
# optional: logind waits on `PauseDeviceComplete` before it hands the VT over,
# so leaving it out stalls every console switch for logind's timeout.
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

# THE WAY BACK FROM A CONSOLE SWITCH, which is the half that is easy to leave
# out and impossible to notice in a build. logind `EVIOCREVOKE`s the descriptor
# it paused, the converter answers the resulting `ENODEV` read with `Stop()`,
# and nothing re-arms that watch -- so a resume that only replaced the
# descriptor would leave the desktop dead after the first `Ctrl+Alt+F<n>` round
# trip. Worse than the `input` group this replaces, which is never revoked at
# all. The device has to go back through `InputDeviceFactoryEvdev`, whose
# `AttachInputDevice` is the only caller of `Start()`.
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

# AND THE MEMBER THAT CARRIES IT COSTS A TRANSLATION UNIT. `InputDeviceOpener`
# was an empty interface, so an inlined `= default` destructor was fine; one
# `base::RepeatingCallback` member makes it "complex" to the chromium-style
# plugin (`tools/clang/plugins/FindBadConstructsConsumer.cpp` scores a single
# templated non-trivial member at 10, and its threshold is 10), and the plugin
# then demands an out-of-line constructor AND destructor. The build runs the
# plugin with `-Werror`, so re-inlining either of them is a failed build 26
# minutes into a contended runner rather than a review comment.
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

# AND THE REOPEN MUST NOT ASK logind AGAIN. `TakeDevice` for a device the
# session already holds is refused, so the descriptor the `ResumeDevice` signal
# carried is the only one there will be -- it has to be what the reopened
# device consumes, and it has to be consulted BEFORE the call that would ask
# for another.
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

# AND A RE-ACQUISITION GIVES THE DEVICE BACK FIRST. On a seat with VTs logind
# never sends the polite pause at all -- it sends "force", having already
# revoked every descriptor -- and promises no `ResumeDevice` afterwards. The
# only way back to a live descriptor is `ReleaseDevice` and then `TakeDevice`,
# in that order: logind refuses `TakeDevice` for a device the session still
# holds, so a retake without the release ahead of it is a device that stays
# dead for the life of the desktop.
giveback_at="$(printf '%s\n' "$opener_body" | grep -n 'GiveBack(' | head -1 | cut -d: -f1)"
if [ -n "$giveback_at" ] && [ -n "$take_at" ] && [ "$giveback_at" -lt "$take_at" ]; then
  ok "a device held from before is given back before it is taken again"
else
  fail "a device held from before is given back before it is taken again" \
    "OpenDeviceFd calls TakeDevice without releasing first; logind refuses it"
fi

# THE `b` IN `TakeDevice`'s `hb` REPLY IS NOT OPTIONAL. logind writes
# `!sd->active` there and revokes the descriptor it is handing over when the
# session is not the one in front of the user, so a caller that pops only the
# descriptor trusts a dead one -- which is a desktop that comes up deaf after a
# startup scan that raced an activation, saying nothing at all.
if in_sources 'PopBool(&inactive)'; then
  ok "the liveness in TakeDevice's reply is read"
else
  fail "the liveness in TakeDevice's reply is read" \
    "nothing pops the boolean beside the descriptor; the fd may be revoked"
fi

# AND THE WAY BACK HANGS OFF THE SESSION'S `Active`, not off a signal that a
# seat with VTs never sends.
for followed in kPropertiesChanged kActive Reclaim; do
  if in_sources "$followed"; then
    ok "the session's activation is followed ($followed)"
  else
    fail "the session's activation is followed ($followed)" \
      "no $followed in the domicile sources; a revoked device would never come back"
  fi
done

# NO FALLBACK TO open(). A desktop that quietly comes up deaf is the bug being
# fixed, so a logind session that is missing or refuses must be a loud failure
# rather than a quiet retreat to the `open` that cannot work.
if in_sources 'open('; then
  fail "there is no fallback to open()" \
    "drm_logind_input.cc calls open(); the whole point is that it cannot work"
else
  ok "there is no fallback to open()"
fi

# The seam, plugged. `InputDeviceOpener` is a one-method pure virtual that
# `InputDeviceFactoryEvdev` takes as a constructor argument, so the platform
# gets to choose -- but only if the choice is actually carried from
# `ozone_platform_drm.cc` down to the evdev thread.
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

# Registered, or it does not link and `--gtest_filter` matching nothing exits
# zero -- the silent pass both workflows' floors exist to refuse.
if in_patches '"domicile/drm_input_devices_unittest.cc"'; then
  ok "the unit test is in the gbm_unittests target"
else
  fail "the unit test is in the gbm_unittests target" \
    "no patch adds domicile/drm_input_devices_unittest.cc to BUILD.gn"
fi

# THE FLOOR, WHICH HAS ONE HOME NOW. It used to be written in both
# engine.yml and engine-drm-probe.yml, and this asserted it was in each —
# which is the check that noticed nothing when the two copies parted
# (`DrmScreenTest:26` against `:18`, and this suite missing from one of
# them altogether). `scripts/engine-drm-unit-tests.sh` is the one list, and
# both jobs run it, so there is one thing to assert and the filter that
# runs is derived from the same array rather than written beside it.
FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *DrmInputDevicesTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'DrmInputDevicesTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop linking and nothing says so"
fi

# A REMOVAL IS REPORTED FROM THE EVDEV THREAD AND HANDLED ON THE UI ONE.
# `InputDeviceFactoryEvdev::DetachInputDevice` calls the controller's
# `OnInputDeviceRemoved` from the evdev thread, and the controller's settings
# push then posted a task bound to its UI-sequence WeakPtr onto the evdev
# thread -- which a console switch, removing every device at once, turned into
# `DCHECK failed: checker.CalledOnValidSequence` and a dead browser. The
# controller hops to its own sequence instead, and a case of its own says so.
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

# AN INACTIVE TAKE IS A RACE AS OFTEN AS IT IS A BACKGROUND CONSOLE, and
# parking the device to wait for an `Active` edge answers only one of those.
# `Reclaim` has exactly one caller -- `OnPropertiesChanged` -- and logind emits
# that on a CHANGE. A session that was already in front of the user when the
# startup scan ran, and that never goes away and comes back, gets no edge ever:
# every device sits revoked for the life of the process and the desktop is deaf
# from the first frame, with no keyboard to switch console with either. So the
# inactive answer has to be checked against the session rather than believed.
if in_sources "SessionIsActive()" && [ "$(grep -c 'SessionIsActive()' "$DOMICILE/drm_logind_input.cc")" -ge 3 ]; then
  ok "an inactive take asks the session rather than waiting for an edge"
else
  fail "an inactive take asks the session rather than waiting for an edge" \
    "OpenDeviceFd parks an inactive device and waits for PropertiesChanged, which never comes for a session that was already active"
fi

# A RESUME IS ANSWERED FROM THE NAMES, NOT FROM THE HOLD. `GiveBack` is on the
# way into every re-take, so a device is absent from the held table for as long
# as it takes to give it back and ask for it again -- and logind still has it
# down as this session's throughout, so a `ResumeDevice` can land in that
# window. A measured run dropped thirteen live descriptors that way, keyboard
# and trackpad among them: every device came up revoked, the whole set was
# force-paused a moment later, and the activation's resumes reached a table
# that no longer named any of them. `names_` is what answers a resume, and only
# a "gone" pause -- the node unplugged -- takes a device out of it.
if grep -q 'names_.find(number)' "$DOMICILE/drm_input_devices.cc" &&
  ! grep -q 'const auto taken = devices_.find(number);'     <(sed -n '/^bool DrmTakenDevices::Resume/,/^}/p' "$DOMICILE/drm_input_devices.cc"); then
  ok "a resume is answered from the names rather than from the held table"
else
  fail "a resume is answered from the names rather than from the held table"     "Resume consults devices_, so a resume arriving between a GiveBack and its TakeDevice throws a live descriptor away"
fi

# THE UNPLUG ARM, not the whole "gone" branch: a release this session asked
# for is answered with a "gone" as well, and that one must NOT forget
# anything. The range starts at the comment that names the real case so the
# two arms cannot be confused for one another.
if grep -q 'names_.erase(number)'   <(sed -n '/The node is unplugged/,/kNothingToSay;/p' "$DOMICILE/drm_input_devices.cc"); then
  ok "a device whose node is gone is forgotten by name too"
else
  fail "a device whose node is gone is forgotten by name too"     "a resume for an unplugged device would be answered with a path that is not there any more"
fi

# AND THE OTHER ARM, WHICH COST A DESKTOP EVERY INPUT DEVICE IT HAD.
# `ReleaseDevice` frees the `SessionDevice` logind was holding, and logind
# reports that the way it reports any other: `PauseDevice(..., "gone")`. So
# every `GiveBack` buys one -- and `GiveBack` is on the way into every
# re-take, so the echo lands AFTER the `TakeDevice` it made room for and
# names a device this session is holding on a newer take. Read as an unplug
# it forgets the name, `Reclaim` then finds nothing, and every `ResumeDevice`
# logind sends on the way back is refused: no keyboard, no pointer, and no
# chord left to leave the console with.
#
# Measured on a real switch: thirteen force pauses, thirteen "gone" in the
# 141 microseconds after them, `reclaimed 0 of 0`, thirteen `logind resumed
# device N, which this session never took`.
if grep -q 'released_' "$DOMICILE/drm_input_devices.cc" &&
  grep -q 'released_\[number\] += 1' "$DOMICILE/drm_input_devices.cc"; then
  ok "a release this session asked for expects the gone it will be answered with"
else
  fail "a release this session asked for expects the gone it will be answered with" \
    "GiveBack does not record the gone logind owes it, so the echo is read as \
the node going away and the device is forgotten while logind still holds it"
fi

# EVERY BUS GETS ITS OWN THREAD, AND THAT IS NOT A TUNING CHOICE. The three
# D-Bus connections this platform opens -- `DrmLogindInput`'s on the evdev
# thread, `DrmVtSwitcher`'s and `DrmSleep`'s on the browser's UI thread -- were
# all built with `SingleThreadTaskRunnerThreadMode::SHARED` and identical
# traits, which is Chromium's way of saying "put these on the same thread".
#
# `DrmLogindInput` is the one that cannot share. Its calls are SYNCHRONOUS by
# design -- `OpenInputDevice` has to answer with a descriptor -- so
# `CallAndBlock` posts `CallMethodAndBlock` to that thread and waits, and
# libdbus does not return to the message loop until logind answers. While it
# is in there, NO OTHER BUS ON THAT THREAD CAN READ ITS SOCKET.
#
# What is on the other end of that is a console switch. logind force-pauses
# every device at once, so the evdev thread makes three blocking round trips
# per device -- `ReleaseDevice`, `TakeDevice`, `Active` -- which on a laptop
# with fifteen input devices is some forty-five, back to back. `DrmVtSwitcher`
# learns the session went inactive from `PropertiesChanged` on ITS bus, and
# that signal waits behind the whole storm. A relinquish that arrives late is
# a GPU process still committing flips into a card whose console belongs to
# somebody else: the atomic commit fails, `PageFlipWatchdog` arms, and fifteen
# seconds later it is `LOG(FATAL) ... Crashing GPU process.`
#
# Whether that race is lost depends on how fast logind services forty-five
# calls, which is why the desktop locked up sometimes on the way out and
# sometimes on the way back rather than every time.
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
