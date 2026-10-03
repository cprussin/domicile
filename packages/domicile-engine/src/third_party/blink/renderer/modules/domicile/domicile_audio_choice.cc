// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_choice.h"

namespace blink {

DomicileAudioChoice::DomicileAudioChoice(const String& name,
                                         const String& description,
                                         bool available)
    : name_(name), description_(description), available_(available) {}

DomicileAudioChoice::~DomicileAudioChoice() = default;

void DomicileAudioChoice::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
