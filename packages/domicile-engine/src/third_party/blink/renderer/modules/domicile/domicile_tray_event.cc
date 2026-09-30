// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_tray_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_tray_event_init.h"

namespace blink {

// static
DomicileTrayEvent* DomicileTrayEvent::Create(
    const AtomicString& type,
    const DomicileTrayEventInit* initializer) {
  return MakeGarbageCollected<DomicileTrayEvent>(type, initializer);
}

DomicileTrayEvent::DomicileTrayEvent(const AtomicString& type,
                                     const DomicileTrayEventInit* initializer)
    : Event(type, initializer),
      items_(MakeGarbageCollected<FrozenArray<DomicileTrayItem>>(
          initializer->items())),
      arrival_(initializer->arrival()) {}

DomicileTrayEvent::DomicileTrayEvent(const AtomicString& type,
                                     HeapVector<Member<DomicileTrayItem>> items,
                                     DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      items_(MakeGarbageCollected<FrozenArray<DomicileTrayItem>>(
          std::move(items))),
      arrival_(arrival) {}

DomicileTrayEvent::~DomicileTrayEvent() = default;

const AtomicString& DomicileTrayEvent::InterfaceName() const {
  return event_interface_names::kDomicileTrayEvent;
}

void DomicileTrayEvent::Trace(Visitor* visitor) const {
  visitor->Trace(items_);
  Event::Trace(visitor);
}

}  // namespace blink
