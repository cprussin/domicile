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
      bookmarks_(MakeGarbageCollected<FrozenArray<DomicileBookmark>>(
          initializer->bookmarks())),
      arrival_(initializer->arrival()) {}

DomicileAppsEvent::DomicileAppsEvent(
    const AtomicString& type,
    String query,
    HeapVector<Member<DomicileDesktopEntry>> apps,
    HeapVector<Member<DomicileBookmark>> bookmarks,
    DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      query_(std::move(query)),
      apps_(MakeGarbageCollected<FrozenArray<DomicileDesktopEntry>>(
          std::move(apps))),
      bookmarks_(MakeGarbageCollected<FrozenArray<DomicileBookmark>>(
          std::move(bookmarks))),
      arrival_(arrival) {}

DomicileAppsEvent::~DomicileAppsEvent() = default;

const AtomicString& DomicileAppsEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppsEvent;
}

void DomicileAppsEvent::Trace(Visitor* visitor) const {
  visitor->Trace(apps_);
  visitor->Trace(bookmarks_);
  Event::Trace(visitor);
}

}  // namespace blink
