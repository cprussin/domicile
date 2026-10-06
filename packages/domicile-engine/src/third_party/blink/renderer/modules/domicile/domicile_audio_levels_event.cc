// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_levels_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_audio_levels_event_init.h"

namespace blink {

// static
DomicileAudioLevelsEvent* DomicileAudioLevelsEvent::Create(
    const AtomicString& type,
    const DomicileAudioLevelsEventInit* initializer) {
  return MakeGarbageCollected<DomicileAudioLevelsEvent>(type, initializer);
}

DomicileAudioLevelsEvent::DomicileAudioLevelsEvent(
    const AtomicString& type,
    const DomicileAudioLevelsEventInit* initializer)
    : Event(type, initializer),
      levels_(MakeGarbageCollected<FrozenArray<DomicileAudioLevel>>(
          initializer->levels())) {}

DomicileAudioLevelsEvent::DomicileAudioLevelsEvent(
    const AtomicString& type,
    HeapVector<Member<DomicileAudioLevel>> levels)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      levels_(MakeGarbageCollected<FrozenArray<DomicileAudioLevel>>(
          std::move(levels))) {}

DomicileAudioLevelsEvent::~DomicileAudioLevelsEvent() = default;

const AtomicString& DomicileAudioLevelsEvent::InterfaceName() const {
  return event_interface_names::kDomicileAudioLevelsEvent;
}

void DomicileAudioLevelsEvent::Trace(Visitor* visitor) const {
  visitor->Trace(levels_);
  Event::Trace(visitor);
}

}  // namespace blink
