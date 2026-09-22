// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_theme_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme_event_init.h"

namespace blink {

// static
DomicileThemeEvent* DomicileThemeEvent::Create(
    const AtomicString& type,
    const DomicileThemeEventInit* initializer) {
  return MakeGarbageCollected<DomicileThemeEvent>(type, initializer);
}

DomicileThemeEvent::DomicileThemeEvent(
    const AtomicString& type,
    const DomicileThemeEventInit* initializer)
    : Event(type, initializer),
      theme_(initializer->theme()),
      arrival_(initializer->arrival()) {}

DomicileThemeEvent::DomicileThemeEvent(const AtomicString& type,
                                       V8DomicileTheme theme,
                                       DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      theme_(theme),
      arrival_(arrival) {}

DomicileThemeEvent::~DomicileThemeEvent() = default;

const AtomicString& DomicileThemeEvent::InterfaceName() const {
  return event_interface_names::kDomicileThemeEvent;
}

void DomicileThemeEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
