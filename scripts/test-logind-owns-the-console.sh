#!/usr/bin/env bash
# Whether logind owns the console, and whether anything asks it to switch.
#
# TWO HALVES, AND ONLY ONE OF THEM EXISTED. `Ctrl+Alt+F<n>` on a tty did
# nothing at all, because `org.freedesktop.login1.Session.TakeControl` --
# which patch `0020` calls, and must, since no ACL covers a keyboard -- puts
# the VT in `K_OFF`, `KD_GRAPHICS` and `VT_PROCESS` itself. The three strings
# are adjacent in `session_prepare_vt` and readable in any shipped
# `systemd-logind`. So the kernel's own chord handling is off from the moment
# the desktop takes its input, and the only process that can start a switch is
# this one.
#
# AND THE OTHER HALF WAS FIGHTING logind FOR THE VT. A second `VT_SETMODE`
# overwrites `vt_mode` and `vt_pid` with no `EBUSY`, so a handshake installed
# here silently takes logind's away: logind never gets its release signal,
# never pauses the devices it lent out, and never hands the console over. The
# fix is to stop asking for the handshake at all and to follow the session
# instead -- which is what every Wayland compositor does, because libseat's
# logind backend has no VT ioctl in it either.
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
# cannot satisfy this -- and, for the refusals below, so that upstream code a
# patch happens to sit next to cannot fail it.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

sources="$(cat "$DOMICILE"/drm_vt_switcher.h "$DOMICILE"/drm_vt_switcher.cc \
  2>/dev/null || true)"
in_sources() { case "$sources" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

for f in drm_vt_switcher.h drm_vt_switcher.cc drm_vt_switcher_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/ozone/platform/drm/domicile"
  fi
done

# THE REFUSAL THIS FILE EXISTS FOR. Every one of these is a way of taking the
# console back off logind, and each of them looks like the obvious thing to
# write. `VT_SETMODE` steals the handshake -- the kernel overwrites `vt_mode`
# and `vt_pid` with no `EBUSY`, so logind simply stops getting its signals --
# and `VT_RELDISP` answers one that no longer arrives here.
#
# COUNTED IN THE PATCHES RATHER THAN FORBIDDEN, because the series is a
# history: `0017` installed a handshake of its own and `0022` takes it back
# out, so what the applied tree carries is the net. A line added and never
# removed is one that is still there.
removed="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^-' || true)"
count() { printf '%s\n' "$2" | grep -a -c -F "$1" || true; }
for gone in 'open("/dev/tty' 'VT_RELDISP' 'VT_SETMODE' 'linux/vt.h'; do
  if [ "$(count "$gone" "$added")" -eq "$(count "$gone" "$removed")" ]; then
    ok "the series leaves no $gone behind"
  else
    fail "the series leaves no $gone behind" \
      "a patch adds $gone and nothing takes it out; logind owns this VT"
  fi
done

# And in `src/`, where there is no history to net out. Prose about the
# handshake that used to be here is the point of the file and must stay
# readable, so what is refused is the include that any of it needs and the
# call itself.
if grep -rql 'linux/vt.h' "$DOMICILE" 2>/dev/null; then
  fail "no domicile source reaches for the VT ioctls" \
    "something under $DOMICILE includes <linux/vt.h>"
else
  ok "no domicile source includes <linux/vt.h>"
fi

if grep -rn 'ioctl(' "$DOMICILE" 2>/dev/null | grep -q 'VT_\|KD_\|KDSET\|KDSKB'; then
  fail "no domicile source drives the console itself" \
    "a VT or KD ioctl is called under $DOMICILE"
else
  ok "no domicile source drives the console itself"
fi

# THE SWITCH ITSELF, which is the half that never existed. logind's
# `Seat.SwitchTo(u)` is what a compositor asks for a console switch -- the
# session's own `Activate` cannot express "whichever session is on VT 3" --
# and `org.freedesktop.login1.chvt` is `allow_active yes` in logind's shipped
# polkit policy, so an active session needs no authentication for it.
if in_sources 'SwitchTo'; then
  ok "the seat's SwitchTo is named"
else
  fail "the seat's SwitchTo is named" \
    "no SwitchTo in domicile/drm_vt_switcher.cc"
fi

# AND THE OBJECT IT IS SENT TO IS READ RATHER THAN WRITTEN DOWN, which is the
# half that shipped broken. `SwitchTo` went to
# `/org/freedesktop/login1/seat/self` and logind answered `UnknownObject` on a
# real tty: `self` is not a name logind stores, it is a lookup through the
# sending connection's own credentials, and `seat_object_find` answers "no such
# object" for every way that lookup comes up empty. `seat0` written out instead
# is the other way to be wrong, on the second seat of a machine that has two.
# The session object `GetSessionByPID` already answered carries the seat it is
# on, so that is what the path comes off.
#
# NAMED RATHER THAN FORBIDDEN BY ITS STRING, because the prose explaining the
# alias is the point of the file: what is checked is the reader that replaced
# it, and that no constant spells a seat path again.
if in_sources 'SeatOfSession'; then
  ok "the seat comes off the session's own Seat property"
else
  fail "the seat comes off the session's own Seat property" \
    "nothing in domicile/drm_vt_switcher.cc reads Session.Seat"
fi

if in_sources 'constexpr char kSeatPath'; then
  fail "no seat object path is written down" \
    "domicile/drm_vt_switcher.cc spells a seat path instead of reading it"
else
  ok "no seat object path is written down"
fi

# WHERE THE CHORD HAS TO BE BOUND, and it is not a free choice. The compositor
# advertises a `wl_seat` and reads no evdev node at all -- it has neither
# libinput nor a session backend -- so the browser process is the only one
# holding a keyboard descriptor, and `PlatformEventObserver` is where a key
# reaches this platform before anything can consume it.
if in_sources 'WillProcessEvent'; then
  ok "the chord is read off the platform's own event stream"
else
  fail "the chord is read off the platform's own event stream" \
    "drm_vt_switcher does not observe PlatformEventSource"
fi

if in_patches 'event_factory_ozone_.get()'; then
  ok "the DRM platform hands the switcher its event source"
else
  fail "the DRM platform hands the switcher its event source" \
    "no patch gives DrmVtSwitcher the PlatformEventSource keys arrive on"
fi

# THE DISPLAY FOLLOWS THE SESSION, not a signal. logind hands the VT over on
# its own schedule now, so the only thing that says the desktop is no longer
# in front of the user is the session's `Active` property.
for member in PropertiesChanged Active; do
  if in_sources "$member"; then
    ok "the session's $member is followed"
  else
    fail "the session's $member is followed" \
      "no $member in domicile/drm_vt_switcher.cc"
  fi
done

# And the seam that does the dropping is still upstream's, reached from the
# process that can: `DrmMaster` (patch `0019`) keeps the browser's own dup of
# every card, and this is its only caller.
for seam in RelinquishDisplayControl TakeDisplayControl; do
  if in_sources "$seam"; then
    ok "$seam is what a switch drives"
  else
    fail "$seam is what a switch drives" \
      "no $seam in domicile/drm_vt_switcher.cc"
  fi
done

for workflow in engine.yml engine-drm-probe.yml; do
  if grep -q "DrmVtSwitcherTest:" "$ROOT/.github/workflows/$workflow" 2>/dev/null; then
    ok "$workflow carries a floor for the suite"
  else
    fail "$workflow carries a floor for the suite" \
      "no 'DrmVtSwitcherTest:<n>' in .github/workflows/$workflow"
  fi
done

# A floor without a run is a count of tests nobody executed, and this suite was
# exactly that: counted in both workflows and named in neither filtered run.
if grep -q 'DrmVtSwitcherTest\.\*' "$ROOT/.github/workflows/engine.yml" 2>/dev/null; then
  ok "engine.yml's filtered run names the suite"
else
  fail "engine.yml's filtered run names the suite" \
    "DrmVtSwitcherTest.* is not in the --gtest_filter"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
