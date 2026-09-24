// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_clipboard_event_init.h"

namespace blink {

// static
DomicileClipboardEvent* DomicileClipboardEvent::Create(
    const AtomicString& type,
    const DomicileClipboardEventInit* initializer) {
  return MakeGarbageCollected<DomicileClipboardEvent>(type, initializer);
}

DomicileClipboardEvent::DomicileClipboardEvent(
    const AtomicString& type,
    const DomicileClipboardEventInit* initializer)
    : Event(type, initializer),
      entries_(MakeGarbageCollected<FrozenArray<DomicileClipboardEntry>>(
          initializer->entries())),
      arrival_(initializer->arrival()) {}

DomicileClipboardEvent::DomicileClipboardEvent(
    const AtomicString& type,
    HeapVector<Member<DomicileClipboardEntry>> entries,
    DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      entries_(MakeGarbageCollected<FrozenArray<DomicileClipboardEntry>>(
          std::move(entries))),
      arrival_(arrival) {}

DomicileClipboardEvent::~DomicileClipboardEvent() = default;

const AtomicString& DomicileClipboardEvent::InterfaceName() const {
  return event_interface_names::kDomicileClipboardEvent;
}

void DomicileClipboardEvent::Trace(Visitor* visitor) const {
  visitor->Trace(entries_);
  Event::Trace(visitor);
}

}  // namespace blink
