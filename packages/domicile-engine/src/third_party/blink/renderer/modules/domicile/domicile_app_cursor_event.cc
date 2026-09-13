// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_app_cursor_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_cursor_event_init.h"

namespace blink {

// static
DomicileAppCursorEvent* DomicileAppCursorEvent::Create(
    const AtomicString& type,
    const DomicileAppCursorEventInit* initializer) {
  return MakeGarbageCollected<DomicileAppCursorEvent>(type, initializer);
}

DomicileAppCursorEvent::DomicileAppCursorEvent(
    const AtomicString& type,
    const DomicileAppCursorEventInit* initializer)
    : Event(type, initializer),
      app_id_(initializer->appId()),
      cursor_(initializer->cursor()),
      arrival_(initializer->arrival()) {}

DomicileAppCursorEvent::DomicileAppCursorEvent(const AtomicString& type,
                                               const String& app_id,
                                               V8DomicileCursorShape cursor,
                                               DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      app_id_(app_id),
      cursor_(cursor),
      arrival_(arrival) {}

DomicileAppCursorEvent::~DomicileAppCursorEvent() = default;

const AtomicString& DomicileAppCursorEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppCursorEvent;
}

void DomicileAppCursorEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
