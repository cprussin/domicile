// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_host.h"

#include <string_view>

#include "components/domicile/common/cursor_shape.h"
#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_shortcut.h"
#include "third_party/blink/renderer/core/event_target_names.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/timing/dom_window_performance.h"
#include "third_party/blink/renderer/core/timing/window_performance.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_modifiers_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_titled_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_display.h"
#include "third_party/blink/renderer/modules/domicile/domicile_shortcut_event.h"
#include "third_party/blink/renderer/platform/bindings/exception_code.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"

namespace blink {

DomicileHost::DomicileHost(LocalDOMWindow& window)
    : window_(&window),
      // `displays_` is left null: a shell that has not been told about a
      // desktop must be able to tell that apart from one told there are no
      // screens. See the attribute's note in the IDL.
      //
      // Initialised in declaration order, which is not a style point here:
      // Chromium builds -Wreorder -Werror, so a list out of order is a build
      // failure rather than a warning.
      channel_(&window),
      client_receiver_(this, &window) {}

DomicileHost::~DomicileHost() = default;

bool DomicileHost::EnsureBound() {
  if (channel_.is_bound()) {
    return true;
  }
  if (!window_ || !window_->GetFrame()) {
    return false;
  }
  auto task_runner = window_->GetTaskRunner(TaskType::kInternalDefault);
  window_->GetBrowserInterfaceBroker().GetInterface(
      channel_.BindNewPipeAndPassReceiver(task_runner));
  if (!channel_.is_bound()) {
    return false;
  }

  // Hand back the other direction in the same breath. A channel bound without
  // a client is one the compositor can be heard on by nobody, and every
  // inbound message would be dropped in the browser with no way to tell.
  channel_->SetClient(
      client_receiver_.BindNewPipeAndPassRemote(task_runner));
  return true;
}

void DomicileHost::spawn(ScriptState* script_state,
                         const Vector<String>& command,
                         ExceptionState& exception_state) {
  // An empty argv reaches the compositor as a request to run nothing, which it
  // cannot answer and should not have to refuse. Caught here so the shell gets
  // a stack rather than silence; the browser refuses it again, because that is
  // where refusing matters.
  if (command.empty()) {
    exception_state.ThrowTypeError(
        "spawn: command must be a non-empty argv array");
    return;
  }
  if (!EnsureBound()) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "There is no compositor for this document to control.");
    return;
  }

  Vector<String> argv;
  argv.reserve(command.size());
  for (const String& argument : command) {
    argv.push_back(argument);
  }
  channel_->Spawn(argv);
}


// Every outbound call needs the same two answers first: is there anything to
// send to, and did the page name a window. Written once rather than twelve
// times, because twelve copies is where one of them ends up missing.
bool DomicileHost::Ready(ExceptionState& exception_state) {
  if (!EnsureBound()) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "There is no compositor for this document to control.");
    return false;
  }
  return true;
}

bool DomicileHost::ReadyForApp(const String& app_id,
                               ExceptionState& exception_state) {
  if (app_id.empty()) {
    exception_state.ThrowTypeError("appId must be a non-empty string");
    return false;
  }
  return Ready(exception_state);
}

void DomicileHost::focusApp(ScriptState*, const String& app_id,
                            ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->FocusApp(app_id);
  }
}

void DomicileHost::focusChrome(ScriptState*, ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->FocusChrome();
  }
}

void DomicileHost::closeApp(ScriptState*, const String& app_id,
                            ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->CloseApp(app_id);
  }
}

void DomicileHost::resizeApp(ScriptState*, const String& app_id, double width,
                             double height,
                             ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->ResizeApp(app_id, width, height);
  }
}

void DomicileHost::setDesktopSize(ScriptState*, double width, double height,
                                  ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetDesktopSize(width, height);
  }
}

void DomicileHost::setDevicePixelRatio(ScriptState*, double ratio,
                                       ExceptionState& exception_state) {
  // A ratio of zero or less is not a scale, and the compositor would divide by
  // it. Refused here because the page is where the mistake is.
  if (!(ratio > 0)) {
    exception_state.ThrowTypeError("ratio must be greater than zero");
    return;
  }
  if (Ready(exception_state)) {
    channel_->SetDevicePixelRatio(ratio);
  }
}

void DomicileHost::grabShortcut(ScriptState*, const DomicileShortcut* shortcut,
                                ExceptionState& exception_state) {
  // Keycode 0 is not a key. A combination of modifiers alone would fire on
  // every keystroke that happens to hold them, which is not a shortcut and is
  // indistinguishable from the page forgetting to say which key it meant.
  if (!shortcut->keycode()) {
    exception_state.ThrowTypeError("keycode must be a non-zero evdev code");
    return;
  }
  if (Ready(exception_state)) {
    channel_->GrabShortcut(domicile::mojom::blink::Shortcut::New(
        shortcut->keycode(), shortcut->altKey(), shortcut->ctrlKey(),
        shortcut->shiftKey(), shortcut->metaKey()));
  }
}

void DomicileHost::key(ScriptState*, const String& app_id, uint32_t keycode,
                       bool pressed, ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->Key(app_id, keycode, pressed);
  }
}

void DomicileHost::pointerMotion(ScriptState*, const String& app_id, double x,
                                 double y, ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerMotion(app_id, x, y);
  }
}

void DomicileHost::pointerLeave(ScriptState*, const String& app_id,
                                ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerLeave(app_id);
  }
}

void DomicileHost::pointerButton(ScriptState*, const String& app_id,
                                 uint32_t button, bool pressed,
                                 ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerButton(app_id, button, pressed);
  }
}

void DomicileHost::pointerAxis(ScriptState*, const String& app_id, double dx,
                               double dy, int32_t v120_x, int32_t v120_y,
                               ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerAxis(app_id, dx, dy, v120_x, v120_y);
  }
}

void DomicileHost::AppAppeared(const String& app_id, const String& title,
                               bool has_size, double width, double height,
                               base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppappeared, app_id, title, String(),
      has_size ? std::make_optional(width) : std::nullopt,
      has_size ? std::make_optional(height) : std::nullopt, Arrival(arrival)));
}

void DomicileHost::AppResized(const String& app_id, double width, double height,
                              base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppresized, app_id, String(), String(), width, height,
      Arrival(arrival)));
}

void DomicileHost::AppClosed(const String& app_id, base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppclosed, app_id, String(), String(), std::nullopt,
      std::nullopt, Arrival(arrival)));
}

void DomicileHost::AppCursor(const String& app_id,
                             domicile::mojom::blink::CursorShape cursor,
                             base::TimeTicks arrival) {
  // BACK TO A STRING, IN ONE PLACE, FROM THE SAME LIST THE BROWSER PARSED IT
  // WITH. `DomicileAppEvent.cursor` is a `DOMString` because what a page does
  // with it is assign it to `style.cursor`, and a WebIDL enum would need a new
  // .idl file registered in two files Chromium owns. What the enum bought is
  // upstream of here: nothing between the compositor's socket and this line can
  // be holding a name that is not one of the shapes, so the string handed to
  // the page is a member of the closed set by construction rather than by
  // hope. See components/domicile/common/cursor_shape.h.
  const std::string_view name = domicile::CursorShapeToWire(cursor);
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppcursor, app_id, String(),
      String::FromUtf8(name), std::nullopt, std::nullopt, Arrival(arrival)));
}

void DomicileHost::ShortcutPressed(domicile::mojom::blink::ShortcutPtr shortcut,
                                   base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileShortcutEvent>(
      event_type_names::kShortcut, shortcut->keycode, shortcut->alt,
      shortcut->ctrl, shortcut->shift, shortcut->meta, Arrival(arrival)));
}

void DomicileHost::Modifiers(bool alt, bool ctrl, bool shift, bool meta,
                             base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileModifiersEvent>(
      event_type_names::kModifiers, alt, ctrl, shift, meta, Arrival(arrival)));
}

void DomicileHost::Displays(
    Vector<domicile::mojom::blink::DisplayInfoPtr> displays) {
  HeapVector<Member<DomicileDisplay>> described;
  described.reserve(displays.size());
  for (const auto& display : displays) {
    described.push_back(MakeGarbageCollected<DomicileDisplay>(
        display->name, display->x, display->y, display->width, display->height,
        display->scale));
  }
  displays_ = MakeGarbageCollected<FrozenArray<DomicileDisplay>>(
      std::move(described));
  // The event says the desktop moved; `displays` says what it is. Splitting
  // them is what lets a component that mounted after the description read the
  // desktop at all -- an event carrying the only copy is gone once dispatched.
  DispatchEvent(*Event::Create(event_type_names::kDisplayschanged));
}

void DomicileHost::FocusChanged(const String& app_id,
                                base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kFocuschanged, app_id, String(), String(), std::nullopt,
      std::nullopt, Arrival(arrival)));
}

// The same event shape as FocusChanged and deliberately a different event: one
// says where the keyboard went and this one says a client would like it. A
// page that conflated them would grant every request by drawing it as granted.
void DomicileHost::FocusRequested(const String& app_id,
                                  base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kFocusrequested, app_id, String(), String(),
      std::nullopt, std::nullopt, Arrival(arrival)));
}

void DomicileHost::AppTitled(const String& app_id, const String& title,
                             base::TimeTicks arrival) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppTitledEvent>(
      event_type_names::kApptitled, app_id, title, Arrival(arrival)));
}

// THE BROWSER'S CLOCK, READ ON THIS DOCUMENT'S. `base::TimeTicks` is monotonic
// and process-agnostic -- the same tick means the same instant in the browser
// and here -- but it is not what a page can subtract from: `Event.timeStamp`
// and `performance.now()` are milliseconds since this document's time origin.
// `WindowPerformance` is what holds that origin, so it is what converts.
//
// It also applies the same resolution clamp every other timestamp the page can
// read goes through, which matters: an unclamped one would be a higher
// resolution timer than the platform means a page to have.
DOMHighResTimeStamp DomicileHost::Arrival(base::TimeTicks arrival) const {
  return DOMWindowPerformance::performance(*window_)
      ->MonotonicTimeToDOMHighResTimeStamp(arrival);
}

const AtomicString& DomicileHost::InterfaceName() const {
  return event_target_names::kDomicileHost;
}

void DomicileHost::AddedEventListener(
    const AtomicString& event_type,
    RegisteredEventListener& registered_listener) {
  EventTarget::AddedEventListener(event_type, registered_listener);
  // Binding is what opens the inbound direction, so a listener registered
  // before anything has been called has to be what opens it. Ignoring the
  // failure is deliberate: there is no exception channel here, and a document
  // with no frame has nothing to hear anyway.
  EnsureBound();
}

ExecutionContext* DomicileHost::GetExecutionContext() const {
  return window_.Get();
}

void DomicileHost::Trace(Visitor* visitor) const {
  visitor->Trace(displays_);
  visitor->Trace(window_);
  visitor->Trace(channel_);
  visitor->Trace(client_receiver_);
  EventTarget::Trace(visitor);
}

}  // namespace blink
