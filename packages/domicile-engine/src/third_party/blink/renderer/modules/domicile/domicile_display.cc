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
                                 uint32_t scale,
                                 uint32_t mode_width,
                                 uint32_t mode_height,
                                 const String& transform,
                                 bool fills_the_window)
    : name_(name),
      x_(x),
      y_(y),
      width_(width),
      height_(height),
      scale_(scale),
      mode_width_(mode_width),
      mode_height_(mode_height),
      transform_(transform),
      fills_the_window_(fills_the_window) {}

DomicileDisplay::~DomicileDisplay() = default;

void DomicileDisplay::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
