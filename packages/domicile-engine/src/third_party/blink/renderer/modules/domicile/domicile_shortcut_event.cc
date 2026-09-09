// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_shortcut_event.h"

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_shortcut_event_init.h"

namespace blink {

// static
DomicileShortcutEvent* DomicileShortcutEvent::Create(
    const AtomicString& type,
    const DomicileShortcutEventInit* initializer) {
  return MakeGarbageCollected<DomicileShortcutEvent>(type, initializer);
}

DomicileShortcutEvent::DomicileShortcutEvent(
    const AtomicString& type,
    const DomicileShortcutEventInit* initializer)
    : Event(type, initializer),
      keycode_(initializer->keycode()),
      alt_(initializer->altKey()),
      ctrl_(initializer->ctrlKey()),
      shift_(initializer->shiftKey()),
      meta_(initializer->metaKey()) {}

DomicileShortcutEvent::DomicileShortcutEvent(const AtomicString& type,
                                             uint32_t keycode,
                                             bool alt,
                                             bool ctrl,
                                             bool shift,
                                             bool meta)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      keycode_(keycode),
      alt_(alt),
      ctrl_(ctrl),
      shift_(shift),
      meta_(meta) {}

DomicileShortcutEvent::~DomicileShortcutEvent() = default;

const AtomicString& DomicileShortcutEvent::InterfaceName() const {
  return event_interface_names::kDomicileShortcutEvent;
}

void DomicileShortcutEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
