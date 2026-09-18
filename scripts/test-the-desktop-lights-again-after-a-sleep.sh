#!/usr/bin/env bash
# Whether the desktop comes back when the machine does.
#
# A SUSPEND IS NOT A CONSOLE SWITCH, AND logind TREATS THEM AS NOTHING ALIKE.
# `session_device_pause_all` and `session_device_resume_all` have exactly three
# callers between them and all three are VT paths -- `logind-seat.c` when a
# seat's active session changes and `logind-session.c` on the switch itself --
# so the evdev descriptors this session took stay open across a suspend and
# nothing sends `PauseDevice`. `DROP_MASTER` is asked for in exactly one place
# too (`logind-session-device.c`), on the same VT path, so DRM master is still
# this process's when the machine comes back. The session never leaves
# `Active`.
#
# WHICH LEAVES ONE THING LOST AND IT IS THE ONE THAT MATTERS. The GPU resumes
# with its CRTCs reset, and the connectors report exactly what they reported
# before: same panels, same modes, same origins. So the hotplug guard --
# `ModesetWouldChangeAnything`, which exists because this driver used to
# modeset in a loop -- answers "nothing changed" and every panel stays dark.
# The resume has to say that what the hardware confirmed before the sleep is
# not a state anything can be compared to any more.
#
# `PrepareForSleep(b)` IS HOW THE MACHINE SAYS SO: `true` on the way down and
# `false` once it is back, broadcast on `org.freedesktop.login1.Manager`.
# logind emits the `false` even for a sleep that failed, so a wake is a wake
# whether or not anything was suspended.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads `src/`
# and `patches/`, which is what makes it cheap enough to run in the shell
# group on every push rather than only when the fork is built.
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

sleeper="$(cat "$DOMICILE"/drm_sleep.h "$DOMICILE"/drm_sleep.cc 2>/dev/null || true)"
in_sleeper() { case "$sleeper" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

modeset="$(cat "$DOMICILE"/drm_modeset.h "$DOMICILE"/drm_modeset.cc 2>/dev/null || true)"
in_modeset() { case "$modeset" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

for f in drm_sleep.h drm_sleep.cc drm_sleep_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/ozone/platform/drm/domicile"
  fi
done

# THE SIGNAL, AND THE OBJECT IT COMES FROM. `PrepareForSleep` is the manager's,
# not the session's: it is one broadcast for the whole machine, so there is no
# `GetSessionByPID` in this path at all.
for named in PrepareForSleep org.freedesktop.login1.Manager /org/freedesktop/login1; do
  if in_sleeper "$named"; then
    ok "the sleeper names $named"
  else
    fail "the sleeper names $named" "nothing in domicile/drm_sleep.cc says $named"
  fi
done

# READ AS A SIGNAL, NOT AS A PROPERTY. `Session.Active` next door arrives inside
# a variant because a property does; `PrepareForSleep`'s body is a plain `b`.
# Reading this one with the property reader pops nothing, and a desktop that
# never lights again is the whole of what that mistake looks like.
if in_sleeper 'PopVariantOfBool'; then
  fail "the signal's body is read as a signal's" \
    "domicile/drm_sleep.cc reads PrepareForSleep through the property reader"
else
  ok "the signal's body is read as a signal's"
fi

# NOTHING IS HANDED BACK FOR A SLEEP. logind pauses no device and drops no
# master across a suspend -- see the head of this file -- so a drop here would
# be this process giving away a display nobody asked it for, and the take on
# the way back is a round trip that can only fail while the session never
# stopped being active.
for refused in RelinquishDisplayControl TakeDisplayControl; do
  if in_sleeper "$refused"; then
    fail "a sleep does not move DRM master" \
      "domicile/drm_sleep.cc calls $refused; logind leaves master alone across a suspend"
  else
    ok "a sleep does not move DRM master ($refused)"
  fi
done

# THE WAKE FORCES A MODESET, which is the whole point and the half that cannot
# be inferred from a hotplug: the hardware reports what it reported before.
if in_sleeper 'Relight'; then
  ok "the wake asks for a relight"
else
  fail "the wake asks for a relight" "domicile/drm_sleep.cc never asks anything to light again"
fi

if in_modeset 'void DrmModeset::Relight'; then
  ok "the modeset driver has a relight to ask for"
else
  fail "the modeset driver has a relight to ask for" \
    "no DrmModeset::Relight in domicile/drm_modeset.cc"
fi

# AND IT FORCES IT BY FORGETTING, which is the one line that makes it work.
# `ModesetWouldChangeAnything` compares against what the hardware last
# confirmed; after a resume that comparison is true and useless.
if in_modeset 'confirmed_.clear()'; then
  ok "a relight forgets what the hardware confirmed"
else
  fail "a relight forgets what the hardware confirmed" \
    "DrmModeset::Relight leaves confirmed_ in place, so the hotplug guard eats the resume"
fi

# THE WIRING, which is a patch because `ozone_platform_drm.cc` is upstream's.
for wired in 'DrmSleep' 'domicile/drm_sleep.cc'; do
  if in_patches "$wired"; then
    ok "a patch carries $wired"
  else
    fail "a patch carries $wired" "no patch in the series adds $wired"
  fi
done

for workflow in engine.yml engine-drm-probe.yml; do
  if grep -q "DrmSleepTest:" "$ROOT/.github/workflows/$workflow" 2>/dev/null; then
    ok "$workflow carries a floor for the suite"
  else
    fail "$workflow carries a floor for the suite" \
      "no 'DrmSleepTest:<n>' in .github/workflows/$workflow"
  fi
done

# A floor without a run is a count of tests nobody executed.
if grep -q 'DrmSleepTest\.\*' "$ROOT/.github/workflows/engine.yml" 2>/dev/null; then
  ok "engine.yml's filtered run names the suite"
else
  fail "engine.yml's filtered run names the suite" \
    "DrmSleepTest.* is not in the --gtest_filter"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
