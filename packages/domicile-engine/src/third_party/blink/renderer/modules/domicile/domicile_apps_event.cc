// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_apps_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_apps_event_init.h"

namespace blink {

// static
DomicileAppsEvent* DomicileAppsEvent::Create(
    const AtomicString& type,
    const DomicileAppsEventInit* initializer) {
  return MakeGarbageCollected<DomicileAppsEvent>(type, initializer);
}

DomicileAppsEvent::DomicileAppsEvent(const AtomicString& type,
                                     const DomicileAppsEventInit* initializer)
    : Event(type, initializer),
      query_(initializer->query()),
      apps_(MakeGarbageCollected<FrozenArray<DomicileDesktopEntry>>(
          initializer->apps())),
      arrival_(initializer->arrival()) {}

DomicileAppsEvent::DomicileAppsEvent(
    const AtomicString& type,
    String query,
    HeapVector<Member<DomicileDesktopEntry>> apps,
    DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      query_(std::move(query)),
      apps_(MakeGarbageCollected<FrozenArray<DomicileDesktopEntry>>(
          std::move(apps))),
      arrival_(arrival) {}

DomicileAppsEvent::~DomicileAppsEvent() = default;

const AtomicString& DomicileAppsEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppsEvent;
}

void DomicileAppsEvent::Trace(Visitor* visitor) const {
  visitor->Trace(apps_);
  Event::Trace(visitor);
}

}  // namespace blink
