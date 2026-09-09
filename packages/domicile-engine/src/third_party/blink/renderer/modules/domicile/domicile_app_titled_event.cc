// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_app_titled_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_titled_event_init.h"
#include "third_party/blink/renderer/core/event_type_names.h"

namespace blink {

// static
DomicileAppTitledEvent* DomicileAppTitledEvent::Create(
    const AtomicString& type,
    const DomicileAppTitledEventInit* initializer) {
  return MakeGarbageCollected<DomicileAppTitledEvent>(type, initializer);
}

DomicileAppTitledEvent::DomicileAppTitledEvent(
    const AtomicString& type,
    const DomicileAppTitledEventInit* initializer)
    : Event(type, initializer),
      app_id_(initializer->appId()),
      title_(initializer->title()) {}

DomicileAppTitledEvent::DomicileAppTitledEvent(const AtomicString& type,
                                               const String& app_id,
                                               const String& title)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      app_id_(app_id),
      title_(title) {}

DomicileAppTitledEvent::~DomicileAppTitledEvent() = default;

const AtomicString& DomicileAppTitledEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppTitledEvent;
}

void DomicileAppTitledEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
