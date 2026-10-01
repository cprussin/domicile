// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_shell_config_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_shell_config_event_init.h"

namespace blink {

// static
DomicileShellConfigEvent* DomicileShellConfigEvent::Create(
    const AtomicString& type,
    const DomicileShellConfigEventInit* initializer) {
  return MakeGarbageCollected<DomicileShellConfigEvent>(type, initializer);
}

DomicileShellConfigEvent::DomicileShellConfigEvent(
    const AtomicString& type,
    const DomicileShellConfigEventInit* initializer)
    : Event(type, initializer),
      config_(initializer->config()),
      arrival_(initializer->arrival()) {}

DomicileShellConfigEvent::DomicileShellConfigEvent(const AtomicString& type,
                                                   const String& config,
                                                   DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      config_(config),
      arrival_(arrival) {}

DomicileShellConfigEvent::~DomicileShellConfigEvent() = default;

const AtomicString& DomicileShellConfigEvent::InterfaceName() const {
  return event_interface_names::kDomicileShellConfigEvent;
}

}  // namespace blink
