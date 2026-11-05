// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_TYPES_NATIVE_SCROLL_SOURCE_H_
#define UI_EVENTS_TYPES_NATIVE_SCROLL_SOURCE_H_

#include <stdint.h>

namespace ui {

// The device supplying an axis frame, independent of its distance and units.
enum class NativeScrollSource : uint8_t {
  kWheel,
  kFinger,
  kContinuous,
  kWheelTilt,
};

}  // namespace ui

#endif  // UI_EVENTS_TYPES_NATIVE_SCROLL_SOURCE_H_
