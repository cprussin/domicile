// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_TYPES_NATIVE_GESTURE_H_
#define UI_EVENTS_TYPES_NATIVE_GESTURE_H_

#include <cstdint>

namespace ui {

// A libinput touchpad gesture, as `zwp_pointer_gestures_v1` names them.
enum class NativeGestureKind : uint8_t { kSwipe, kPinch, kHold };

enum class NativeGesturePhase : uint8_t { kBegin, kUpdate, kEnd };

// One phase of a touchpad gesture the desktop takes for its shell.
//
// `dx` and `dy` are this update's motion in the touchpad's accelerated
// pointer units. `scale` is relative to the begin, and `rotation` is this
// update's, in degrees clockwise. A hold has only a begin and an end.
struct NativeGesture {
  NativeGestureKind kind = NativeGestureKind::kSwipe;
  NativeGesturePhase phase = NativeGesturePhase::kBegin;
  uint32_t fingers = 0;
  double dx = 0;
  double dy = 0;
  double scale = 1;
  double rotation = 0;
  bool canceled = false;
};

}  // namespace ui

#endif  // UI_EVENTS_TYPES_NATIVE_GESTURE_H_
