// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_level.h"

namespace blink {

DomicileAudioLevel::DomicileAudioLevel(const String& id, double peak)
    : id_(id), peak_(peak) {}

DomicileAudioLevel::~DomicileAudioLevel() = default;

void DomicileAudioLevel::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
