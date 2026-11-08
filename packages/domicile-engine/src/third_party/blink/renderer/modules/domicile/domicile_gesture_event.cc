// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_gesture_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_gesture_event_init.h"

namespace blink {

// static
DomicileGestureEvent* DomicileGestureEvent::Create(
    const AtomicString& type,
    const DomicileGestureEventInit* initializer) {
  return MakeGarbageCollected<DomicileGestureEvent>(type, initializer);
}

DomicileGestureEvent::DomicileGestureEvent(
    const AtomicString& type,
    const DomicileGestureEventInit* initializer)
    : Event(type, initializer),
      kind_(initializer->kind()),
      phase_(initializer->phase()),
      fingers_(initializer->fingers()),
      dx_(initializer->dx()),
      dy_(initializer->dy()),
      scale_(initializer->scale()),
      rotation_(initializer->rotation()),
      canceled_(initializer->canceled()),
      edge_(initializer->edge()) {}

DomicileGestureEvent::DomicileGestureEvent(const AtomicString& type,
                                           const String& kind,
                                           const String& phase,
                                           uint32_t fingers,
                                           double dx,
                                           double dy,
                                           double scale,
                                           double rotation,
                                           bool canceled,
                                           const String& edge)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      kind_(kind),
      phase_(phase),
      fingers_(fingers),
      dx_(dx),
      dy_(dy),
      scale_(scale),
      rotation_(rotation),
      canceled_(canceled),
      edge_(edge) {}

DomicileGestureEvent::~DomicileGestureEvent() = default;

const AtomicString& DomicileGestureEvent::InterfaceName() const {
  return event_interface_names::kDomicileGestureEvent;
}

void DomicileGestureEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
