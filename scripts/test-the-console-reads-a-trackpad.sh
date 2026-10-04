#!/usr/bin/env bash
# Tests that the console browser turns trackpad input into pointer motion.
#
# In an unpatched tree nothing turns pad input into pointer motion.
# `CreateConverter` (`ui/events/ozone/evdev/input_device_opener_evdev.cc`)
# has one touchpad branch, gated on `USE_EVDEV_GESTURES`, which is ChromeOS
# only. A laptop pad is not a touchscreen (`INPUT_PROP_POINTER` makes
# `HasDirect()` false), so it gets `EventConverterEvdevImpl`, which has no
# `EV_ABS` case. Finger positions are dropped without a log, and the pointer
# draws but does not move.
#
# Two things are needed together:
#
#   use_libinput = true   or the converter is not compiled
#   patch 0027            or libinput opens the device by name and gets EACCES,
#                         because on a console logind owns `/dev/input/*` and
#                         the browser is not root
#
# `test-the-builds-agree-on-ozone.sh` checks the build argument. This checks
# the patch.
#
# Needs no Chromium tree: it reads the patch series and `src/`, so it runs in
# the shell group on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
LAUNCH="$ROOT/packages/domicile-launch/src/spawn.rs"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
removed="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^-' || true)"
in_added()   { case "$added"   in (*"$1"*) return 0 ;; (*) return 1 ;; esac }
in_removed() { case "$removed" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# Checked first, so a series that stops touching these files cannot pass the
# checks below by omission.
if in_added "libinput_event_converter"; then
  ok "the series touches the libinput converter"
else
  fail "the series touches the libinput converter" \
    "no patch mentions libinput_event_converter, so a touchpad has no reader"
fi

# `CreateConverter` receives an open `fd`. The libinput branch must use it
# instead of opening the path itself.
if in_added "LibInputEventConverter::Create(std::move(fd)"; then
  ok "the libinput branch is handed the descriptor the opener already has"
else
  fail "the libinput branch is handed the descriptor the opener already has" \
    "CreateConverter still drops fd on the floor for libinput"
fi

if in_removed "int fd = open(path, flags);"; then
  ok "open_restricted no longer opens the device by name"
else
  fail "open_restricted no longer opens the device by name" \
    "libinput still calls open() on a node logind owns, which answers EACCES"
fi

# On the heap: libinput keeps the pointer as user data for the context's life,
# and the context is moved out of `Create`, so a member address would dangle.
if in_added "struct OpenedDevice"; then
  ok "the descriptor is parked somewhere a move cannot invalidate"
else
  fail "the descriptor is parked somewhere a move cannot invalidate" \
    "no OpenedDevice holder, so open_restricted has nowhere to read an fd from"
fi

# The class allows one device per context, so a second request is a bug.
# Falling back to open() there would fail with EACCES and log nothing.
if in_added "has no descriptor left to give it"; then
  ok "a second ask is refused rather than quietly retried with open()"
else
  fail "a second ask is refused rather than quietly retried with open()" \
    "no refusal, so a spent context falls back to the open() that fails"
fi

# `use_libinput = true` links libinput into `libcontent.so`, and the build runs
# the host tool `v8_context_snapshot_generator`. The build shell must be able
# to load libinput.so.10, so it must stay in the library list in
# `tools/nix/make-shell-for-system.nix`.
if in_added "libinput # libinput.so.10"; then
  ok "the build shell can load what the browser links"
else
  fail "the build shell can load what the browser links" \
    "libinput is not in tools/nix/make-shell-for-system.nix, so every host binary the build runs dies on libinput.so.10"
fi

# Routing needs a flag. `EventDeviceInfo::UseLibinput` prefers an overridden
# `kLibinputHandleTouchpad` to its heuristics, and the feature is disabled by
# default. Without the override an ordinary pad never reaches libinput.
if grep -q -- "--enable-features=LibinputHandleTouchpad" "$LAUNCH"; then
  ok "the launcher routes touchpads to libinput"
else
  fail "the launcher routes touchpads to libinput" \
    "spawn.rs does not pass --enable-features=LibinputHandleTouchpad, so UseLibinput falls back to heuristics that answer false for an ordinary pad"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
