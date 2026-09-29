// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_extensions_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_extensions_event_init.h"

namespace blink {

// static
DomicileExtensionsEvent* DomicileExtensionsEvent::Create(
    const AtomicString& type,
    const DomicileExtensionsEventInit* initializer) {
  return MakeGarbageCollected<DomicileExtensionsEvent>(type, initializer);
}

DomicileExtensionsEvent::DomicileExtensionsEvent(
    const AtomicString& type,
    const DomicileExtensionsEventInit* initializer)
    : Event(type, initializer),
      extensions_(MakeGarbageCollected<FrozenArray<DomicileExtension>>(
          initializer->extensions())) {}

DomicileExtensionsEvent::DomicileExtensionsEvent(
    const AtomicString& type,
    HeapVector<Member<DomicileExtension>> extensions)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      extensions_(MakeGarbageCollected<FrozenArray<DomicileExtension>>(
          std::move(extensions))) {}

DomicileExtensionsEvent::~DomicileExtensionsEvent() = default;

const AtomicString& DomicileExtensionsEvent::InterfaceName() const {
  return event_interface_names::kDomicileExtensionsEvent;
}

void DomicileExtensionsEvent::Trace(Visitor* visitor) const {
  visitor->Trace(extensions_);
  Event::Trace(visitor);
}

}  // namespace blink
