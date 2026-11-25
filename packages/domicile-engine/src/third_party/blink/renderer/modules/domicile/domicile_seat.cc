// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_seat.h"

#include "third_party/blink/renderer/platform/heap/garbage_collected.h"

namespace blink {

DomicileSeat::DomicileSeat(const String& id,
                           const String& name,
                           std::optional<double> pointer_x,
                           std::optional<double> pointer_y,
                           const String& focused,
                           const Vector<String>& holds,
                           const Vector<String>& taken)
    : id_(id),
      name_(name),
      pointer_x_(pointer_x),
      pointer_y_(pointer_y),
      focused_(focused),
      holds_(MakeGarbageCollected<FrozenArray<IDLString>>(Vector<String>(holds))),
      taken_(MakeGarbageCollected<FrozenArray<IDLString>>(Vector<String>(taken))) {}

DomicileSeat::~DomicileSeat() = default;

void DomicileSeat::Trace(Visitor* visitor) const {
  visitor->Trace(holds_);
  visitor->Trace(taken_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
