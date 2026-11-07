// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_DOMICILE_NATIVE_GESTURE_SINK_H_
#define UI_EVENTS_DOMICILE_NATIVE_GESTURE_SINK_H_

#include <cstdint>

#include "ui/events/events_export.h"
#include "ui/events/types/native_gesture.h"

namespace ui {

// Two fingers belong to the page under the pointer: its scrolling, pinch zoom
// and history swipes. Gestures of this many fingers or more are the shell's
// to bind.
inline constexpr uint32_t kFewestShellGestureFingers = 3;

// Where the platform hands the touchpad gestures the shell binds.
//
// libinput (tty) and `zwp_pointer_gestures_v1` (nested) recognize a gesture;
// the shell binds it by kind and finger count. The platform asks `Takes` at a
// gesture's begin and, if so, hands every phase to `Take` instead of
// dispatching it. //components/domicile installs the one sink, so //ui needs no
// dependency on it.
//
// Called from the platform's input thread: an implementation locks.
class EVENTS_EXPORT NativeGestureSink {
 public:
  virtual ~NativeGestureSink() = default;

  // Whether the shell binds a `kind` gesture of `fingers`.
  virtual bool Takes(NativeGestureKind kind, uint32_t fingers) = 0;

  // A phase of a gesture this took at its begin.
  virtual void Take(const NativeGesture& gesture) = 0;

  // The installed sink, or null before one is.
  static NativeGestureSink* Get();

  // Installs `sink`, which lives for the rest of the process.
  static void Set(NativeGestureSink* sink);
};

// Begins, updates and ends one gesture sequence, handing it to the sink if
// the sink took its begin. For a platform's per-device gesture state.
class EVENTS_EXPORT NativeGestureSequence {
 public:
  // Whether the sink took `gesture`, a begin. Ends a sequence still open,
  // canceled, first.
  bool Begin(const NativeGesture& gesture);

  // Whether the sink took `gesture`, an update or end of the open sequence.
  // An end closes it.
  bool Continue(const NativeGesture& gesture);

  // Ends an open sequence, canceled. For a device that went away.
  void Cancel();

 private:
  bool taken_ = false;
  NativeGestureKind kind_ = NativeGestureKind::kSwipe;
  uint32_t fingers_ = 0;
};

}  // namespace ui

#endif  // UI_EVENTS_DOMICILE_NATIVE_GESTURE_SINK_H_
