#!/usr/bin/env bash
# Tests that the window on a console tells views it is active.
#
# The platform window reports activation: `WaylandWindow` from
# `xdg_toplevel.configure`, `X11Window` from `WM_TAKE_FOCUS`. Upstream's
# `DrmWindowHost` never does; `Activate()` is `NOTIMPLEMENTED_LOG_ONCE()`. Ash
# decides activation itself, so it does not need this.
#
# In views, `DesktopWindowTreeHostPlatform::is_active_` changes only through
# `OnActivationChanged`, which leads to `FocusManager::RestoreFocusedView`.
# Without it no view holds focus and every key event is dropped, with nothing
# in the logs.
#
# Needs no Chromium tree: it reads `patches/`, so it runs in the shell group on
# every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Added lines only (`^+`), so upstream code quoted as context does not count.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# Only this call can make a views widget active.
if in_patches "delegate_->OnActivationChanged("; then
  ok "the window tells its delegate about activation"
else
  fail "the window tells its delegate about activation" \
    "no patch calls PlatformWindowDelegate::OnActivationChanged, so is_active_ stays false and no view is ever focused"
fi

# `Show`, `Activate`, `Hide` and `Deactivate` all go through one helper, so
# checking the helper and each argument covers all four.
if in_patches "void DrmWindowHost::SetActive(bool active) {"; then
  ok "one helper decides activation"
else
  fail "one helper decides activation" \
    "no patch adds DrmWindowHost::SetActive, so each caller would have to get the guard right on its own"
fi

for answer in "SetActive(true);" "SetActive(false);" "SetActive(!inactive);"; do
  if in_patches "  $answer"; then
    ok "something asks for $answer"
  else
    fail "something asks for $answer" \
      "no caller reaches SetActive with that answer, so views is never told"
  fi
done

# `NOTIMPLEMENTED_LOG_ONCE()` compiles to nothing in a release build, so both
# upstream bodies must go. A silent `Deactivate` leaves focus on a window that
# lost it.
removed="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -ac '^-  NOTIMPLEMENTED_LOG_ONCE();' || true)"
if [ "${removed:-0}" -ge 2 ]; then
  ok "neither Activate nor Deactivate is a compiled-out log"
else
  fail "neither Activate nor Deactivate is a compiled-out log" \
    "expected both NOTIMPLEMENTED_LOG_ONCE() bodies removed, found ${removed:-0}"
fi

# Everything below `DispatchEvent` is silent on success. These log lines tell
# "nothing is read" apart from "events arrive and something above drops them".
for said in "the first key event reached the window" \
            "the first pointer event a hand caused"; do
  if in_patches "$said"; then
    ok "the log names $said"
  else
    fail "the log names $said" \
      "DispatchEvent says nothing, so a desktop that answers nothing cannot say which half is broken"
  fi
done

# `SetFullscreen` reaches `SynthesizeMouseMove`, which posts a synthesized
# `kMouseMoved` about 200ms into startup, when the cursor is always in bounds.
# If the one-shot pointer log accepted it, it would fire before any real input
# and report a working pointer that is not.
if in_patches "EF_IS_SYNTHESIZED"; then
  ok "the startup's own synthesized move cannot spend the pointer log"
else
  fail "the startup's own synthesized move cannot spend the pointer log" \
    "the one-shot is gated on IsLocatedEvent alone again, so it fires 200ms in and answers nothing"
fi

# A move can reach the page while a press is swallowed by a non-client hit
# test, so each is logged separately. A drawn cursor proves neither: the
# cursor plane moves from the evdev thread and never reaches a renderer.
if in_patches "the first mouse press reached the window"; then
  ok "a press is reported apart from a move"
else
  fail "a press is reported apart from a move" \
    "only motion is reported, so a click that never arrives and one that arrives unwanted look the same"
fi

# The `EventResult` from `DispatchEventFromNativeUiEvent` separates "the click
# arrived" from "it arrived and nothing handled it". They have different fixes.
if in_patches "const EventResult result = DispatchEventFromNativeUiEvent"; then
  ok "the answer views gives is read rather than discarded"
else
  fail "the answer views gives is read rather than discarded" \
    "the EventResult is thrown away again, so ER_UNHANDLED cannot be told from never arriving"
fi

# `CanDispatchEvent` drops out-of-bounds located events without a trace. The
# `TODO(spang): For non-ash builds` below it marks that policy as ash's.
if in_patches "so it was refused"; then
  ok "a pointer event dropped for being out of bounds says so"
else
  fail "a pointer event dropped for being out of bounds says so" \
    "CanDispatchEvent still refuses located events in silence, which is indistinguishable from never reading one"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
