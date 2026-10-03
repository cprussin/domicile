// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_card.h"

#include <utility>

namespace blink {

DomicileAudioCard::DomicileAudioCard(
    const String& id,
    const String& description,
    HeapVector<Member<DomicileAudioChoice>> profiles,
    const String& profile)
    : id_(id),
      description_(description),
      profiles_(MakeGarbageCollected<FrozenArray<DomicileAudioChoice>>(
          std::move(profiles))),
      profile_(profile) {}

DomicileAudioCard::~DomicileAudioCard() = default;

void DomicileAudioCard::Trace(Visitor* visitor) const {
  visitor->Trace(profiles_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
