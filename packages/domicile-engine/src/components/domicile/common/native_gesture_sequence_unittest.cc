// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/domicile/native_gesture_sink.h"
#include "ui/events/types/native_gesture.h"

namespace domicile {
namespace {

using ui::NativeGesture;
using ui::NativeGestureKind;
using ui::NativeGesturePhase;
using ui::NativeGestureSequence;
using ui::NativeGestureSink;

// Takes three-finger swipes, and records what it was handed.
class RecordingSink : public NativeGestureSink {
 public:
  bool Takes(const NativeGesture& begin) override {
    return begin.kind == NativeGestureKind::kSwipe && begin.fingers == 3;
  }
  void Take(const NativeGesture& gesture) override {
    taken.push_back(gesture);
  }

  std::vector<NativeGesture> taken;
};

// The process has one sink, which lives for the rest of it. Installed again
// for each test, since a control channel's test installs the desk's.
RecordingSink& Sink() {
  static RecordingSink* sink = new RecordingSink();
  NativeGestureSink::Set(sink);
  sink->taken.clear();
  return *sink;
}

NativeGesture Swipe(NativeGesturePhase phase, uint32_t fingers = 0) {
  return {.kind = NativeGestureKind::kSwipe,
          .phase = phase,
          .fingers = fingers};
}

// An update carries no finger count on Wayland; the sink still hears it as
// the gesture's.
TEST(NativeGestureSequenceTest, ATakenGestureIsHandedOverWithItsFingers) {
  RecordingSink& sink = Sink();
  NativeGestureSequence sequence;

  EXPECT_TRUE(sequence.Begin(Swipe(NativeGesturePhase::kBegin, 3)));
  EXPECT_TRUE(sequence.Continue(Swipe(NativeGesturePhase::kUpdate)));
  EXPECT_TRUE(sequence.Continue(Swipe(NativeGesturePhase::kEnd)));

  ASSERT_EQ(sink.taken.size(), 3u);
  EXPECT_EQ(sink.taken[1].fingers, 3u);
  EXPECT_EQ(sink.taken[2].phase, NativeGesturePhase::kEnd);
  // Ended: what follows is the platform's.
  EXPECT_FALSE(sequence.Continue(Swipe(NativeGesturePhase::kUpdate)));
}

// A pinch the shell does not bind stays the page's.
TEST(NativeGestureSequenceTest, AGestureNotTakenStaysThePlatforms) {
  RecordingSink& sink = Sink();
  NativeGestureSequence sequence;

  EXPECT_FALSE(sequence.Begin(Swipe(NativeGesturePhase::kBegin, 4)));
  EXPECT_FALSE(sequence.Continue(Swipe(NativeGesturePhase::kUpdate)));

  EXPECT_TRUE(sink.taken.empty());
}

// A device that goes away mid-gesture ends it, so a binding is not left
// waiting.
TEST(NativeGestureSequenceTest, CancelingEndsATakenGesture) {
  RecordingSink& sink = Sink();
  NativeGestureSequence sequence;
  sequence.Begin(Swipe(NativeGesturePhase::kBegin, 3));

  sequence.Cancel();
  sequence.Cancel();

  ASSERT_EQ(sink.taken.size(), 2u);
  EXPECT_EQ(sink.taken[1].phase, NativeGesturePhase::kEnd);
  EXPECT_TRUE(sink.taken[1].canceled);
}

}  // namespace
}  // namespace domicile
