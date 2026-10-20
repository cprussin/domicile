// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_will_navigate_event.h"

#include "third_party/blink/renderer/core/event_interface_names.h"

namespace blink {

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` cancels the navigation.
DomicileWillNavigateEvent::DomicileWillNavigateEvent(const AtomicString& type,
                                                     const String& url)
    : Event(type, Bubbles::kYes, Cancelable::kYes), url_(url) {}

DomicileWillNavigateEvent::~DomicileWillNavigateEvent() = default;

const AtomicString& DomicileWillNavigateEvent::InterfaceName() const {
  return event_interface_names::kDomicileWillNavigateEvent;
}

}  // namespace blink
