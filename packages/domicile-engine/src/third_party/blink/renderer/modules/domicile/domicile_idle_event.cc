// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_idle_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_idle_event_init.h"

namespace blink {

// static
DomicileIdleEvent* DomicileIdleEvent::Create(
    const AtomicString& type,
    const DomicileIdleEventInit* initializer) {
  return MakeGarbageCollected<DomicileIdleEvent>(type, initializer);
}

DomicileIdleEvent::DomicileIdleEvent(const AtomicString& type,
                                     const DomicileIdleEventInit* initializer)
    : Event(type, initializer),
      idle_(initializer->idle()),
      arrival_(initializer->arrival()) {}

DomicileIdleEvent::DomicileIdleEvent(const AtomicString& type,
                                     bool idle,
                                     DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      idle_(idle),
      arrival_(arrival) {}

DomicileIdleEvent::~DomicileIdleEvent() = default;

const AtomicString& DomicileIdleEvent::InterfaceName() const {
  return event_interface_names::kDomicileIdleEvent;
}

}  // namespace blink
