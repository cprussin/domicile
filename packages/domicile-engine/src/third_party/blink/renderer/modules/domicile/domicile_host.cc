// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_host.h"

#include "third_party/blink/renderer/core/event_target_names.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_titled_event.h"
#include "third_party/blink/renderer/platform/bindings/exception_code.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"

namespace blink {

DomicileHost::DomicileHost(LocalDOMWindow& window)
    : window_(&window),
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

void DomicileHost::resizeApp(ScriptState*, const String& app_id,
                             uint32_t width, uint32_t height,
                             ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->ResizeApp(app_id, width, height);
  }
}

void DomicileHost::setDesktopSize(ScriptState*, uint32_t width, uint32_t height,
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

void DomicileHost::grabShortcut(ScriptState*, const String& shortcut,
                                ExceptionState& exception_state) {
  if (shortcut.empty()) {
    exception_state.ThrowTypeError("shortcut must be a non-empty string");
    return;
  }
  if (Ready(exception_state)) {
    channel_->GrabShortcut(shortcut);
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
                               bool has_size, uint32_t width,
                               uint32_t height) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppappeared, app_id, title, String(),
      has_size ? std::make_optional(width) : std::nullopt,
      has_size ? std::make_optional(height) : std::nullopt));
}

void DomicileHost::AppResized(const String& app_id, uint32_t width,
                              uint32_t height) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppresized, app_id, String(), String(), width,
      height));
}

void DomicileHost::AppClosed(const String& app_id) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppclosed, app_id, String(), String(), std::nullopt,
      std::nullopt));
}

void DomicileHost::AppCursor(const String& app_id, const String& cursor) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kAppcursor, app_id, String(), cursor, std::nullopt,
      std::nullopt));
}

void DomicileHost::Shortcut(const String& shortcut) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kShortcut, String(), shortcut, String(), std::nullopt,
      std::nullopt));
}

void DomicileHost::Modifiers(uint32_t depressed, uint32_t latched,
                             uint32_t locked, uint32_t group) {
  // Carried in width/height would be a lie. Modifiers get their own shape when
  // a shell needs them; for now the event fires so a shell can resync, which is
  // what the seat state is actually used for.
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kModifiers, String(), String(), String(),
      std::make_optional(depressed), std::make_optional(latched)));
}

void DomicileHost::FocusChanged(const String& app_id) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      event_type_names::kFocuschanged, app_id, String(), String(),
      std::nullopt, std::nullopt));
}


void DomicileHost::AppTitled(const String& app_id,
                             const String& title) {
  DispatchEvent(*MakeGarbageCollected<DomicileAppTitledEvent>(
      event_type_names::kApptitled, app_id, title));
}

const AtomicString& DomicileHost::InterfaceName() const {
  return event_target_names::kDomicileHost;
}

ExecutionContext* DomicileHost::GetExecutionContext() const {
  return window_.Get();
}

void DomicileHost::Trace(Visitor* visitor) const {
  visitor->Trace(window_);
  visitor->Trace(channel_);
  visitor->Trace(client_receiver_);
  EventTarget::Trace(visitor);
}

}  // namespace blink
