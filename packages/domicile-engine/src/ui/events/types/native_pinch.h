// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_TYPES_NATIVE_PINCH_H_
#define UI_EVENTS_TYPES_NATIVE_PINCH_H_

#include <cstdint>

namespace ui {

enum class NativePinchPhase : uint8_t { kBegin, kUpdate, kEnd };

// The platform gesture, before Chromium converts its incremental zoom to a
// Ctrl+wheel event. Native clients need the original absolute scale.
struct NativePinch {
  NativePinchPhase phase = NativePinchPhase::kBegin;
  uint32_t device = 0;
  uint32_t time = 0;
  uint32_t fingers = 0;
  double dx = 0;
  double dy = 0;
  double scale = 1;
  double rotation = 0;
  bool canceled = false;
};

}  // namespace ui

#endif  // UI_EVENTS_TYPES_NATIVE_PINCH_H_
