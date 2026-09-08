// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_modifiers_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_modifiers_event_init.h"

namespace blink {

// static
DomicileModifiersEvent* DomicileModifiersEvent::Create(
    const AtomicString& type,
    const DomicileModifiersEventInit* initializer) {
  return MakeGarbageCollected<DomicileModifiersEvent>(type, initializer);
}

DomicileModifiersEvent::DomicileModifiersEvent(
    const AtomicString& type,
    const DomicileModifiersEventInit* initializer)
    : Event(type, initializer),
      depressed_(initializer->depressed()),
      latched_(initializer->latched()),
      locked_(initializer->locked()),
      group_(initializer->group()) {}

DomicileModifiersEvent::DomicileModifiersEvent(const AtomicString& type,
                                               uint32_t depressed,
                                               uint32_t latched,
                                               uint32_t locked,
                                               uint32_t group)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      depressed_(depressed),
      latched_(latched),
      locked_(locked),
      group_(group) {}

DomicileModifiersEvent::~DomicileModifiersEvent() = default;

const AtomicString& DomicileModifiersEvent::InterfaceName() const {
  return event_interface_names::kDomicileModifiersEvent;
}

void DomicileModifiersEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
