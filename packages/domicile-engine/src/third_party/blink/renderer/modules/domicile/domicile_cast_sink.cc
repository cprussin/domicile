// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_cast_sink.h"

namespace blink {

DomicileCastSink::DomicileCastSink(const String& id,
                                   const String& name,
                                   const String& route)
    : id_(id), name_(name), route_(route) {}

DomicileCastSink::~DomicileCastSink() = default;

void DomicileCastSink::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
