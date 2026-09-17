#!/usr/bin/env bash
# Whether a trackpad has anything at all reading it.
#
# NOTHING IN AN UNPATCHED TREE TURNS A PAD INTO POINTER MOTION, and that is not
# a figure of speech. `CreateConverter`
# (`ui/events/ozone/evdev/input_device_opener_evdev.cc`) has exactly one
# touchpad branch, `#if defined(USE_EVDEV_GESTURES)`, and that flag is
# `use_evdev_gestures = is_chromeos_device`. A laptop pad is not a touchscreen
# either -- `HasTouchscreen()` is `HasAbsXY() && HasDirect()` and
# `INPUT_PROP_POINTER` makes `HasDirect()` false -- so it falls through to
# `EventConverterEvdevImpl`, whose `ProcessEvents` handles `EV_MSC`, `EV_KEY`,
# `EV_REL`, `EV_SYN` and `EV_SW` and has no `EV_ABS` case. Every finger
# position is read off the descriptor and dropped, `x_offset_` stays zero,
# `FlushEvents` returns before `cursor_->MoveCursor`, and NOTHING IS LOGGED
# because nothing failed. The symptom is a pointer that draws and does not
# move, which is what the machine did.
#
# So two things have to be true together, and either alone is useless:
#
#   use_libinput = true   or the converter is not even compiled
#   patch 0027            or libinput opens the device by name and gets EACCES,
#                         because on a console logind owns `/dev/input/*` and
#                         this browser is not root
#
# The build-argument half is asserted by `test-the-builds-agree-on-ozone.sh`,
# which checks both `gn gen` blocks. This is the patch half.
#
# NO CHROMIUM TREE. The series and `src/` are the source of truth, so this runs
# in the shell group on every push.
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

# The positive first, so a series that stopped touching these files at all
# cannot pass every check below by saying nothing.
if in_added "libinput_event_converter"; then
  ok "the series touches the libinput converter"
else
  fail "the series touches the libinput converter" \
    "no patch mentions libinput_event_converter, so a touchpad has no reader"
fi

# THE DESCRIPTOR, WHICH IS THE WHOLE PATCH. `CreateConverter` is handed an
# already-open `fd` and every other branch takes it; the libinput branch
# dropped it and opened the path itself.
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

# On the heap, and that is not a style preference: libinput keeps the pointer
# as its user data for the life of the context, and the context is moved out of
# `Create`, so a member address would dangle before libinput ever asked.
if in_added "struct OpenedDevice"; then
  ok "the descriptor is parked somewhere a move cannot invalidate"
else
  fail "the descriptor is parked somewhere a move cannot invalidate" \
    "no OpenedDevice holder, so open_restricted has nowhere to read an fd from"
fi

# A second ask is a bug, not a case to fall back for: one device per context is
# this class's own documented rule. Falling back to open() would be the exact
# call that cannot work, made quietly.
if in_added "has no descriptor left to give it"; then
  ok "a second ask is refused rather than quietly retried with open()"
else
  fail "a second ask is refused rather than quietly retried with open()" \
    "no refusal, so a spent context falls back to the open() that fails"
fi

# AND THE BUILD HAS TO BE ABLE TO LOAD WHAT IT LINKS. `use_libinput = true`
# links libinput into `libcontent.so`, and `v8_context_snapshot_generator` is a
# host tool the build links and then RUNS -- so a sysroot that satisfied the
# linker is not enough, and the build died on `libinput.so.10: cannot open
# shared object file` ten minutes in. `tools/nix/make-shell-for-system.nix`
# already carries a list of libraries headed by that exact error and that exact
# binary's name; this is the assertion that libinput stays in it.
if in_added "libinput # libinput.so.10"; then
  ok "the build shell can load what the browser links"
else
  fail "the build shell can load what the browser links" \
    "libinput is not in tools/nix/make-shell-for-system.nix, so every host binary the build runs dies on libinput.so.10"
fi

# ROUTING IS A FLAG, NOT A PATCH. `EventDeviceInfo::UseLibinput` prefers an
# overridden `kLibinputHandleTouchpad` to its own heuristics, and the feature
# is FEATURE_DISABLED_BY_DEFAULT -- so without the override an ordinary
# multitouch pad is not routed to libinput at all and the patch above never
# runs.
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
