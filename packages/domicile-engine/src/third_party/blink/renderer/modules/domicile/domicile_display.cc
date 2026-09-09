// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_display.h"

namespace blink {

DomicileDisplay::DomicileDisplay(const String& name,
                                 int32_t x,
                                 int32_t y,
                                 uint32_t width,
                                 uint32_t height,
                                 uint32_t scale)
    : name_(name),
      x_(x),
      y_(y),
      width_(width),
      height_(height),
      scale_(scale) {}

DomicileDisplay::~DomicileDisplay() = default;

void DomicileDisplay::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
