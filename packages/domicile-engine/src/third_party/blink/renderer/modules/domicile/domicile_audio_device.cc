// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_audio_device.h"

#include <utility>

namespace blink {

DomicileAudioDevice::DomicileAudioDevice(
    const String& id,
    const String& description,
    double volume,
    bool muted,
    bool is_default,
    bool monitor,
    HeapVector<Member<DomicileAudioChoice>> ports,
    const String& port)
    : id_(id),
      description_(description),
      volume_(volume),
      muted_(muted),
      is_default_(is_default),
      monitor_(monitor),
      ports_(MakeGarbageCollected<FrozenArray<DomicileAudioChoice>>(
          std::move(ports))),
      port_(port) {}

DomicileAudioDevice::~DomicileAudioDevice() = default;

void DomicileAudioDevice::Trace(Visitor* visitor) const {
  visitor->Trace(ports_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
