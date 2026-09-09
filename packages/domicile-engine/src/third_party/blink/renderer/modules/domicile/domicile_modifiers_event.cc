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
      alt_(initializer->altKey()),
      ctrl_(initializer->ctrlKey()),
      shift_(initializer->shiftKey()),
      meta_(initializer->metaKey()) {}

DomicileModifiersEvent::DomicileModifiersEvent(const AtomicString& type,
                                               bool alt,
                                               bool ctrl,
                                               bool shift,
                                               bool meta)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      alt_(alt),
      ctrl_(ctrl),
      shift_(shift),
      meta_(meta) {}

DomicileModifiersEvent::~DomicileModifiersEvent() = default;

const AtomicString& DomicileModifiersEvent::InterfaceName() const {
  return event_interface_names::kDomicileModifiersEvent;
}

void DomicileModifiersEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
