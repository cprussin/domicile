// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_open_url_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_open_url_event_init.h"

namespace blink {

// static
DomicileOpenUrlEvent* DomicileOpenUrlEvent::Create(
    const AtomicString& type,
    const DomicileOpenUrlEventInit* initializer) {
  return MakeGarbageCollected<DomicileOpenUrlEvent>(type, initializer);
}

DomicileOpenUrlEvent::DomicileOpenUrlEvent(
    const AtomicString& type,
    const DomicileOpenUrlEventInit* initializer)
    : Event(type, initializer), url_(initializer->url()) {}

DomicileOpenUrlEvent::DomicileOpenUrlEvent(const AtomicString& type,
                                           const String& url)
    : Event(type, Bubbles::kNo, Cancelable::kNo), url_(url) {}

DomicileOpenUrlEvent::~DomicileOpenUrlEvent() = default;

const AtomicString& DomicileOpenUrlEvent::InterfaceName() const {
  return event_interface_names::kDomicileOpenUrlEvent;
}

}  // namespace blink
