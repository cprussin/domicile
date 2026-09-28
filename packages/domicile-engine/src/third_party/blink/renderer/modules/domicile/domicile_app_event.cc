// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_event_init.h"

namespace blink {

// static
DomicileAppEvent* DomicileAppEvent::Create(
    const AtomicString& type,
    const DomicileAppEventInit* initializer) {
  return MakeGarbageCollected<DomicileAppEvent>(type, initializer);
}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const DomicileAppEventInit* initializer)
    : Event(type, initializer),
      app_id_(initializer->appId()),
      title_(initializer->title()),
      parent_app_id_(initializer->parentAppId()),
      x_(initializer->x()),
      y_(initializer->y()),
      grab_(initializer->grab()),
      arrival_(initializer->arrival()) {
  if (initializer->hasWidth() && initializer->hasHeight()) {
    width_ = initializer->width();
    height_ = initializer->height();
  }
}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const String& app_id,
                                   const String& title,
                                   std::optional<double> width,
                                   std::optional<double> height,
                                   DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      app_id_(app_id),
      title_(title),
      width_(width),
      height_(height),
      arrival_(arrival) {}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const String& app_id,
                                   const String& parent_app_id,
                                   double x,
                                   double y,
                                   double width,
                                   double height,
                                   bool grab,
                                   DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      app_id_(app_id),
      width_(width),
      height_(height),
      parent_app_id_(parent_app_id),
      x_(x),
      y_(y),
      grab_(grab),
      arrival_(arrival) {}

DomicileAppEvent::~DomicileAppEvent() = default;

const AtomicString& DomicileAppEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppEvent;
}

void DomicileAppEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
