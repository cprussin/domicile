// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_event_init.h"

namespace blink {

// static
DomicileAppEvent* DomicileAppEvent::Create(
    const AtomicString& type,
    const DomicileAppEventInit* initializer) {
  return MakeGarbageCollected<DomicileAppEvent>(type, initializer);
}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const DomicileAppEventInit* initializer)
    : Event(type, initializer), app_id_(initializer->appId()) {}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const String& app_id)
    : Event(type, Bubbles::kNo, Cancelable::kNo), app_id_(app_id) {}

DomicileAppEvent::~DomicileAppEvent() = default;

const AtomicString& DomicileAppEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppEvent;
}

void DomicileAppEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
