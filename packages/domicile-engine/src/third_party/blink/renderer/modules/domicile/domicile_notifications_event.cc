// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_notifications_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_notifications_event_init.h"

namespace blink {

// static
DomicileNotificationsEvent* DomicileNotificationsEvent::Create(
    const AtomicString& type,
    const DomicileNotificationsEventInit* initializer) {
  return MakeGarbageCollected<DomicileNotificationsEvent>(type, initializer);
}

DomicileNotificationsEvent::DomicileNotificationsEvent(
    const AtomicString& type,
    const DomicileNotificationsEventInit* initializer)
    : Event(type, initializer),
      items_(MakeGarbageCollected<FrozenArray<DomicileNotification>>(
          initializer->items())),
      arrival_(initializer->arrival()) {}

DomicileNotificationsEvent::DomicileNotificationsEvent(
    const AtomicString& type,
    HeapVector<Member<DomicileNotification>> items,
    DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      items_(MakeGarbageCollected<FrozenArray<DomicileNotification>>(
          std::move(items))),
      arrival_(arrival) {}

DomicileNotificationsEvent::~DomicileNotificationsEvent() = default;

const AtomicString& DomicileNotificationsEvent::InterfaceName() const {
  return event_interface_names::kDomicileNotificationsEvent;
}

void DomicileNotificationsEvent::Trace(Visitor* visitor) const {
  visitor->Trace(items_);
  Event::Trace(visitor);
}

}  // namespace blink
