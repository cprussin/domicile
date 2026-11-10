#!/usr/bin/env bash
# Checks pinch works as on a Mac: a pinch magnifies the page under the
# pointer, and Meta+pinch or Meta+scroll magnifies the desk.
#
# Upstream hands a <webview>'s pinch to the outermost page, the desk, and
# carries no modifiers on a pinch. A patch keeps a pinch in the page,
# stops plain pinches reaching the desk, and sends Meta's to the desk.
# Another sends a pinch to the desk's host window on every monitor, as a
# mouse or scroll event goes.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# The lines the series adds to (+) or removes from (-) one file.
changes() { # $1 sign, $2 path
  cat "$PATCHES"/*.patch 2>/dev/null |
    awk -v sign="$1" -v path="$2" '
      /^diff --git/ { on = index($0, " a/" path " ") > 0 }
      on && substr($0, 1, 1) == sign && substr($0, 1, 3) != sign sign sign'
}
check() { # $1 what, $2 sign, $3 path, $4 text, $5 why
  case "$(changes "$2" "$3")" in
    (*"$4"*) ok "$1" ;;
    (*) fail "$1" "$5" ;;
  esac
}

check "a <webview>'s page magnifies itself" + \
  content/browser/renderer_host/cross_process_frame_connector.cc \
  "if (child && child->is_main_frame()) {" \
  "GetPinchZoomTarget still hands a <webview>'s pinch to the desk"
check "the desk never takes a plain pinch" - \
  content/browser/renderer_host/render_widget_host_view_aura.cc \
  "ForwardTouchpadZoomEventIfNecessary(event, ack_result);" \
  "RenderWidgetHostViewAura still page-scales the desk from an unconsumed pinch"
check "a pinch begun with Meta goes to the desk" + \
  components/input/render_widget_host_input_event_router.cc \
  "desk_pinch_ = event->GetModifiers() & blink::WebInputEvent::kMetaKey;" \
  "RouteTouchpadGestureEvent does not look for Meta"
check "Meta+scroll magnifies the desk" + \
  components/input/render_widget_host_input_event_router.cc \
  "ZoomDeskBy(root_view, *event," \
  "RouteMouseWheelEvent does not turn Meta+scroll into a desk pinch"
check "libinput pinches carry the keyboard's modifiers" + \
  ui/events/ozone/evdev/event_factory_evdev.cc \
  "modifiers_.GetModifierFlags(), params.timestamp, details);" \
  "EventFactoryEvdev::DispatchPinchEvent still sends no modifiers"
check "the host's pinches carry the keyboard's modifiers" + \
  ui/ozone/platform/wayland/host/wayland_event_source.cc \
  "GestureEvent event(location.x(), location.y(), keyboard_modifiers_," \
  "WaylandEventSource::OnPinchEvent still sends no modifiers"
check "a pinch goes to the desk's host on every monitor" + \
  ui/ozone/platform/drm/host/drm_window_host.cc \
  "event->IsGestureEvent() || event->IsKeyEvent() || bound_touch)) {" \
  "CanDispatchEvent sends a pinch to the window whose bounds hold the pointer's row place"
check "a pinch is placed where the pointer is on the desk" + \
  ui/ozone/platform/drm/host/drm_window_host.cc \
  "event->IsGestureEvent() || event->IsTouchEvent()" \
  "DispatchEvent places a pinch with upstream's row arithmetic"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
