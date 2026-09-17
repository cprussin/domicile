#!/usr/bin/env bash
# Whether the window on a console tells views it is the active one.
#
# ACTIVATION IS A FACT THE PLATFORM REPORTS UPWARD. `WaylandWindow` reports it
# from `xdg_toplevel.configure`'s activated state; `X11Window` reports it from
# `WM_TAKE_FOCUS`. Upstream's `DrmWindowHost` reports it never: `Show()` sets
# no activation and `Activate()` is `NOTIMPLEMENTED_LOG_ONCE()`, which in a
# release build is silence. Ash is ozone/drm's only upstream consumer and ash
# decides activation itself, so nothing there ever noticed.
#
# A views browser is not ash. `DesktopWindowTreeHostPlatform::is_active_`
# starts false and only `OnActivationChanged` moves it; that call is what
# reaches `DesktopNativeWidgetAura::HandleActivationChanged` and so
# `FocusManager::RestoreFocusedView`. Without it no view in the widget holds
# focus and every key event dispatched into the tree is dropped -- a desktop
# that draws, follows the pointer, and answers no key. That failure is silent
# in every log, which is why it is worth a guard rather than a comment.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads
# `patches/` and runs in the shell group on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Added lines only (`^+`), so a patch that merely quotes upstream in context
# cannot satisfy any of this.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

# The call itself. Nothing else in the tree can make a views widget active.
if in_patches "delegate_->OnActivationChanged("; then
  ok "the window tells its delegate about activation"
else
  fail "the window tells its delegate about activation" \
    "no patch calls PlatformWindowDelegate::OnActivationChanged, so is_active_ stays false and no view is ever focused"
fi

# It is reached from every place views drives activation from: showing the
# window at startup (`Show`), asking for it later (`Activate`), and both ways
# of withdrawing it (`Hide`, `Deactivate`). One helper carries all four, so
# asserting it exists and that both answers are asked for covers them.
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

# `NOTIMPLEMENTED_LOG_ONCE()` compiles to nothing in the shipped engine
# (`is_debug = false` takes `DLOG` out), so an `Activate` that ends in one is
# a desktop that cannot be typed into and does not say so. Both of upstream's
# have to go: `Deactivate`'s silence is how a window keeps focus it has lost.
removed="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -ac '^-  NOTIMPLEMENTED_LOG_ONCE();' || true)"
if [ "${removed:-0}" -ge 2 ]; then
  ok "neither Activate nor Deactivate is a compiled-out log"
else
  fail "neither Activate nor Deactivate is a compiled-out log" \
    "expected both NOTIMPLEMENTED_LOG_ONCE() bodies removed, found ${removed:-0}"
fi

# THE LOG SAYS WHETHER EVENTS ARRIVE AT ALL. Everything below `DispatchEvent`
# is silent on success, so a converter that read nothing and one that read
# everything look identical -- and reading that silence as dead descriptors is
# what cost two wrong diagnoses. These two lines are the difference between
# "nothing is being read" and "it arrives and something above drops it".
for said in "the first key event reached the window" \
            "the first pointer event a hand caused"; do
  if in_patches "$said"; then
    ok "the log names $said"
  else
    fail "the log names $said" \
      "DispatchEvent says nothing, so a desktop that answers nothing cannot say which half is broken"
  fi
done

# AND A SYNTHESIZED EVENT MUST NOT SATISFY THE POINTER ONE. `SetFullscreen`
# reaches `SynthesizeMouseMove`, which posts a `kMouseMoved` carrying
# `EF_IS_SYNTHESIZED` about 200ms into every startup, from inside
# `CommitBoundsChange` -- the one instant when the cursor's rect and `bounds_`
# are equal by construction, so it always passes the bounds test. Gated on
# `IsLocatedEvent()` alone the one-shot is spent before a hand touches
# anything, which is exactly how patch 0026's message came to say "the
# trackpad works and always did" about a trackpad nothing was reading. The
# guard is here because that is not a mistake anybody makes once.
if in_patches "EF_IS_SYNTHESIZED"; then
  ok "the startup's own synthesized move cannot spend the pointer log"
else
  fail "the startup's own synthesized move cannot spend the pointer log" \
    "the one-shot is gated on IsLocatedEvent alone again, so it fires 200ms in and answers nothing"
fi

# A PRESS AND A MOVE FAIL SEPARATELY, so they are asked about separately: a
# move can reach the page while a press is swallowed by a non-client hit test,
# and a drawn cursor is evidence for neither -- that is the cursor plane, moved
# from the evdev thread, which never reaches a renderer.
if in_patches "the first mouse press reached the window"; then
  ok "a press is reported apart from a move"
else
  fail "a press is reported apart from a move" \
    "only motion is reported, so a click that never arrives and one that arrives unwanted look the same"
fi

# AND WHAT VIEWS SAID ABOUT IT. `DispatchEventFromNativeUiEvent` returns an
# `EventResult` and the call used to drop it on the floor, which made "the
# click arrived" and "the click arrived and nothing wanted it" the same
# observation from outside the process. They have different fixes.
if in_patches "const EventResult result = DispatchEventFromNativeUiEvent"; then
  ok "the answer views gives is read rather than discarded"
else
  fail "the answer views gives is read rather than discarded" \
    "the EventResult is thrown away again, so ER_UNHANDLED cannot be told from never arriving"
fi

# A REFUSAL IS THE OTHER HALF. `CanDispatchEvent`'s located branch is a bare
# `bounds_.Contains(...)` whose false costs the event with no trace, and the
# `TODO(spang): For non-ash builds` three lines below says whose policy it is.
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
