// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
      cursor_(initializer->cursor()) {
  if (initializer->hasWidth() && initializer->hasHeight()) {
    width_ = initializer->width();
    height_ = initializer->height();
  }
}

DomicileAppEvent::DomicileAppEvent(const AtomicString& type,
                                   const String& app_id,
                                   const String& title,
                                   const String& cursor,
                                   std::optional<uint32_t> width,
                                   std::optional<uint32_t> height)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      app_id_(app_id),
      title_(title),
      cursor_(cursor),
      width_(width),
      height_(height) {}

DomicileAppEvent::~DomicileAppEvent() = default;

const AtomicString& DomicileAppEvent::InterfaceName() const {
  return event_interface_names::kDomicileAppEvent;
}

void DomicileAppEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
