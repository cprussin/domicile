// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/domicile/native_gesture_sink.h"

#include <atomic>

#include "base/check.h"

namespace ui {
namespace {

std::atomic<NativeGestureSink*> g_sink{nullptr};

}  // namespace

// static
NativeGestureSink* NativeGestureSink::Get() {
  return g_sink.load(std::memory_order_acquire);
}

// static
void NativeGestureSink::Set(NativeGestureSink* sink) {
  CHECK(sink);
  g_sink.store(sink, std::memory_order_release);
}

bool NativeGestureSequence::Begin(const NativeGesture& gesture) {
  CHECK(gesture.phase == NativeGesturePhase::kBegin);
  Cancel();
  NativeGestureSink* sink = NativeGestureSink::Get();
  taken_ = sink && sink->Takes(gesture);
  kind_ = gesture.kind;
  fingers_ = gesture.fingers;
  edge_ = gesture.edge;
  if (taken_) {
    sink->Take(gesture);
  }
  return taken_;
}

bool NativeGestureSequence::Continue(const NativeGesture& gesture) {
  CHECK(gesture.phase != NativeGesturePhase::kBegin);
  if (!taken_ || gesture.kind != kind_) {
    return false;
  }
  NativeGesture continued = gesture;
  continued.fingers = fingers_;
  continued.edge = edge_;
  if (gesture.phase == NativeGesturePhase::kEnd) {
    taken_ = false;
  }
  NativeGestureSink::Get()->Take(continued);
  return true;
}

void NativeGestureSequence::Cancel() {
  if (!taken_) {
    return;
  }
  NativeGesture end;
  end.kind = kind_;
  end.phase = NativeGesturePhase::kEnd;
  end.fingers = fingers_;
  end.edge = edge_;
  end.canceled = true;
  Continue(end);
}

}  // namespace ui
