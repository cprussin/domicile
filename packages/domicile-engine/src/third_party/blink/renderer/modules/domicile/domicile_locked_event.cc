// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_locked_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_locked_event_init.h"

namespace blink {

// static
DomicileLockedEvent* DomicileLockedEvent::Create(
    const AtomicString& type,
    const DomicileLockedEventInit* initializer) {
  return MakeGarbageCollected<DomicileLockedEvent>(type, initializer);
}

DomicileLockedEvent::DomicileLockedEvent(
    const AtomicString& type,
    const DomicileLockedEventInit* initializer)
    : Event(type, initializer),
      locked_(initializer->locked()),
      arrival_(initializer->arrival()) {}

DomicileLockedEvent::DomicileLockedEvent(const AtomicString& type,
                                         bool locked,
                                         DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      locked_(locked),
      arrival_(arrival) {}

DomicileLockedEvent::~DomicileLockedEvent() = default;

const AtomicString& DomicileLockedEvent::InterfaceName() const {
  return event_interface_names::kDomicileLockedEvent;
}

}  // namespace blink
