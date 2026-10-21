#!/usr/bin/env bash
# Checks that the DRM platform takes each card from logind's
# `Session.TakeDevice`, and that a console switch cannot crash the GPU process.
#
# logind sets DRM master on a card it hands over, drops it when the console
# switches away and sets it again on the way back. Guards:
#   - the browser opening the card itself, which leaves master to whoever
#     opened the card first and nobody to drop it on a switch
#   - a second D-Bus connection taking cards: logind accepts `TakeDevice`
#     only from the one that called `TakeControl`
#   - a flip that fails after logind dropped master arming `PageFlipWatchdog`,
#     which kills the GPU process 15 s later
#
# Reads `src/` and `patches/` instead of a Chromium tree, so it runs in the
# shell group.
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

# Lines the series removes from `drm_display_host_manager.cc`.
removed_from_host="$(awk '
  /^diff --git a\// { in_file = ($0 ~ /host\/drm_display_host_manager\.cc$/); next }
  in_file && /^-[^-]/ { print }
' "$PATCHES"/*.patch)"

if in_patches 'scoped_fd = logind->TakeCard(dev_path);'; then
  ok "OpenDrmDevice takes the card from logind"
else
  fail "OpenDrmDevice takes the card from logind" \
    "no patch makes OpenDrmDevice call DrmLogindSession::TakeCard"
fi

case "$removed_from_host" in
  (*'open(dev_path.value().c_str(), O_RDWR | O_CLOEXEC)'*)
    ok "the browser does not open the card itself" ;;
  (*)
    fail "the browser does not open the card itself" \
      "OpenDrmDevice still calls open() on the card" ;;
esac

if in_patches 'logind_->ReleaseCard(event.path);'; then
  ok "a removed card is given back to logind"
else
  fail "a removed card is given back to logind" \
    "nothing releases a card on removal, so a card plugged in again is refused"
fi

# One connection for cards and input: `DrmLogindInput` must not build a bus.
if grep -q 'dbus::Bus::Options' "$DOMICILE/drm_logind_input.cc" 2>/dev/null; then
  fail "the cards and the input devices share the connection that took control" \
    "drm_logind_input.cc opens its own bus; logind refuses TakeDevice from it"
else
  ok "the cards and the input devices share the connection that took control"
fi

if in_patches 'logind_ = std::make_unique<DrmLogindSession>();'; then
  ok "the DRM platform takes the session before it opens a card"
else
  fail "the DRM platform takes the session before it opens a card" \
    "no patch builds DrmLogindSession in InitializeUI"
fi

# A card's `PauseDevice` and `ResumeDevice` are the session's to answer; the
# input listener knows only evdev devices.
if grep -q 'kDrmMajor = 226' "$DOMICILE/drm_logind_session.cc" 2>/dev/null; then
  ok "a card's signals are told apart from an input device's"
else
  fail "a card's signals are told apart from an input device's" \
    "drm_logind_session.cc does not route signals by the DRM major number"
fi

if in_patches 'if (!GetDrmDevice()->HoldsMaster()) {'; then
  ok "a flip after logind dropped master is skipped, not fatal"
else
  fail "a flip after logind dropped master is skipped, not fatal" \
    "HardwareDisplayController arms PageFlipWatchdog for it and the GPU process dies 15 s into another console"
fi

if in_patches 'friend class ui::DrmLogindSession;'; then
  ok "the session may wait on logind from the UI thread"
else
  fail "the session may wait on logind from the UI thread" \
    "DrmLogindSession is not a friend of ScopedAllowBaseSyncPrimitivesOutsideBlockingScope"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
