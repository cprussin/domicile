// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_audio_event_init.h"

namespace blink {

// static
DomicileAudioEvent* DomicileAudioEvent::Create(
    const AtomicString& type,
    const DomicileAudioEventInit* initializer) {
  return MakeGarbageCollected<DomicileAudioEvent>(type, initializer);
}

DomicileAudioEvent::DomicileAudioEvent(
    const AtomicString& type,
    const DomicileAudioEventInit* initializer)
    : Event(type, initializer),
      outputs_(MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
          initializer->outputs())),
      inputs_(MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
          initializer->inputs())),
      playback_(MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
          initializer->playback())),
      recording_(MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
          initializer->recording())),
      cards_(MakeGarbageCollected<FrozenArray<DomicileAudioCard>>(
          initializer->cards())),
      arrival_(initializer->arrival()) {}

DomicileAudioEvent::DomicileAudioEvent(
    const AtomicString& type,
    HeapVector<Member<DomicileAudioDevice>> outputs,
    HeapVector<Member<DomicileAudioDevice>> inputs,
    HeapVector<Member<DomicileAudioStream>> playback,
    HeapVector<Member<DomicileAudioStream>> recording,
    HeapVector<Member<DomicileAudioCard>> cards,
    DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      outputs_(MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
          std::move(outputs))),
      inputs_(MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
          std::move(inputs))),
      playback_(MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
          std::move(playback))),
      recording_(MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
          std::move(recording))),
      cards_(MakeGarbageCollected<FrozenArray<DomicileAudioCard>>(
          std::move(cards))),
      arrival_(arrival) {}

DomicileAudioEvent::~DomicileAudioEvent() = default;

const AtomicString& DomicileAudioEvent::InterfaceName() const {
  return event_interface_names::kDomicileAudioEvent;
}

void DomicileAudioEvent::Trace(Visitor* visitor) const {
  visitor->Trace(outputs_);
  visitor->Trace(inputs_);
  visitor->Trace(playback_);
  visitor->Trace(recording_);
  visitor->Trace(cards_);
  Event::Trace(visitor);
}

}  // namespace blink
