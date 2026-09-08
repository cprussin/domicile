// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_host.h"

#include "third_party/blink/renderer/core/event_target_names.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
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

  Vector<WTF::String> argv;
  argv.reserve(command.size());
  for (const String& argument : command) {
    argv.push_back(argument);
  }
  channel_->Spawn(argv);
}

void DomicileHost::AppTitled(const WTF::String& app_id,
                             const WTF::String& title) {
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
