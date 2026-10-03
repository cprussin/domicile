// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_stream.h"

namespace blink {

DomicileAudioStream::DomicileAudioStream(const String& id,
                                         const String& application,
                                         const String& title,
                                         double volume,
                                         bool muted,
                                         const String& device)
    : id_(id),
      application_(application),
      title_(title),
      volume_(volume),
      muted_(muted),
      device_(device) {}

DomicileAudioStream::~DomicileAudioStream() = default;

void DomicileAudioStream::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
