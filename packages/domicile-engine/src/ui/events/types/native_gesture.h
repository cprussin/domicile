// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_TYPES_NATIVE_GESTURE_H_
#define UI_EVENTS_TYPES_NATIVE_GESTURE_H_

#include <cstdint>
#include <optional>

namespace ui {

// A libinput touchpad gesture, as `zwp_pointer_gestures_v1` names them, or
// one finger in from a touchscreen's edge.
enum class NativeGestureKind : uint8_t { kSwipe, kPinch, kHold, kEdge };

// The side of the display an edge swipe came in from.
enum class NativeGestureEdge : uint8_t { kLeft, kRight, kTop, kBottom };

enum class NativeGesturePhase : uint8_t { kBegin, kUpdate, kEnd };

// One phase of a gesture the desktop takes for its shell.
//
// `dx` and `dy` are this update's motion: in the touchpad's accelerated
// pointer units, or an edge swipe's in the display's pixels. `scale` is
// relative to the begin, and `rotation` is this update's, in degrees
// clockwise. A hold has only a begin and an end. An edge swipe is one finger
// and has its `edge`; nothing else does.
struct NativeGesture {
  NativeGestureKind kind = NativeGestureKind::kSwipe;
  NativeGesturePhase phase = NativeGesturePhase::kBegin;
  uint32_t fingers = 0;
  double dx = 0;
  double dy = 0;
  double scale = 1;
  double rotation = 0;
  bool canceled = false;
  std::optional<NativeGestureEdge> edge;
};

}  // namespace ui

#endif  // UI_EVENTS_TYPES_NATIVE_GESTURE_H_
