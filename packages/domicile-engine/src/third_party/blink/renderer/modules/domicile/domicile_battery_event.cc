// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_battery_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_battery_event_init.h"

namespace blink {

// static
DomicileBatteryEvent* DomicileBatteryEvent::Create(
    const AtomicString& type,
    const DomicileBatteryEventInit* initializer) {
  return MakeGarbageCollected<DomicileBatteryEvent>(type, initializer);
}

DomicileBatteryEvent::DomicileBatteryEvent(
    const AtomicString& type,
    const DomicileBatteryEventInit* initializer)
    : Event(type, initializer),
      charge_(initializer->charge()),
      charging_(initializer->charging()),
      arrival_(initializer->arrival()) {}

DomicileBatteryEvent::DomicileBatteryEvent(const AtomicString& type,
                                           double charge,
                                           bool charging,
                                           DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      charge_(charge),
      charging_(charging),
      arrival_(arrival) {}

DomicileBatteryEvent::~DomicileBatteryEvent() = default;

const AtomicString& DomicileBatteryEvent::InterfaceName() const {
  return event_interface_names::kDomicileBatteryEvent;
}

}  // namespace blink
