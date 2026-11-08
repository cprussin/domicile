// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/domicile/edge_swipe.h"

#include <optional>
#include <vector>

#include "base/memory/raw_ref.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/domicile/native_gesture_sink.h"
#include "ui/events/types/native_gesture.h"

namespace domicile {
namespace {

using ui::EdgeSwipe;
using ui::EventType;
using ui::NativeGesture;
using ui::NativeGestureEdge;
using ui::NativeGestureKind;
using ui::NativeGesturePhase;
using ui::NativeGestureSink;
using Verdict = EdgeSwipe::Verdict;

// Takes swipes in from the left and the bottom, and records what it was
// handed.
class RecordingSink : public NativeGestureSink {
 public:
  bool Takes(const NativeGesture& begin) override {
    return begin.kind == NativeGestureKind::kEdge &&
           (begin.edge == NativeGestureEdge::kLeft ||
            begin.edge == NativeGestureEdge::kBottom);
  }
  void Take(const NativeGesture& gesture) override { taken.push_back(gesture); }

  std::vector<NativeGesture> taken;
};

// The process has one sink, which lives for the rest of it. Installed again
// for each test, since other tests install their own.
RecordingSink& Sink() {
  static RecordingSink* sink = new RecordingSink();
  NativeGestureSink::Set(sink);
  sink->taken.clear();
  return *sink;
}

// A 1000 by 500 display to the right of another: the band is 30 pixels
// across the left edge and 15 up from the bottom, and a swipe is 60 pixels in
// from the left or 30 up.
const gfx::RectF kDisplay(1000, 0, 1000, 500);

class EdgeSwipeTest : public testing::Test {
 protected:
  Verdict Touch(EventType type, int slot, float x, float y) {
    now_ += base::Milliseconds(10);
    return swipe_.Touch(type, slot, gfx::PointF(x, y), kDisplay, now_);
  }
  Verdict Down(float x, float y, int slot = 0) {
    return Touch(EventType::kTouchPressed, slot, x, y);
  }
  Verdict Move(float x, float y, int slot = 0) {
    return Touch(EventType::kTouchMoved, slot, x, y);
  }
  Verdict Up(float x, float y, int slot = 0) {
    return Touch(EventType::kTouchReleased, slot, x, y);
  }

  const raw_ref<RecordingSink> sink_{Sink()};
  EdgeSwipe swipe_;
  base::TimeTicks now_;
};

// In from the left edge: withheld until it has come far enough, then the
// shell's from begin to end, with its motion in the display's pixels.
TEST_F(EdgeSwipeTest, AFingerInFromABoundEdgeIsTheShells) {
  EXPECT_EQ(Down(1010, 200), Verdict::kWithhold);
  EXPECT_EQ(Move(1040, 205), Verdict::kWithhold);
  EXPECT_EQ(Move(1080, 210), Verdict::kTaken);
  EXPECT_EQ(Move(1200, 210), Verdict::kTaken);
  EXPECT_EQ(Up(1200, 210), Verdict::kTaken);

  ASSERT_EQ(sink_->taken.size(), 4u);
  EXPECT_EQ(sink_->taken[0].phase, NativeGesturePhase::kBegin);
  EXPECT_EQ(sink_->taken[0].edge, NativeGestureEdge::kLeft);
  EXPECT_EQ(sink_->taken[0].fingers, 1u);
  EXPECT_EQ(sink_->taken[1].phase, NativeGesturePhase::kUpdate);
  EXPECT_EQ(sink_->taken[1].dx, 70);
  EXPECT_EQ(sink_->taken[1].dy, 10);
  EXPECT_EQ(sink_->taken[2].dx, 120);
  EXPECT_EQ(sink_->taken[3].phase, NativeGesturePhase::kEnd);
  EXPECT_FALSE(sink_->taken[3].canceled);
  EXPECT_FALSE(swipe_.deadline());
}

// Up from the bottom, which the sink also binds.
TEST_F(EdgeSwipeTest, EachBoundEdgeIsItsOwn) {
  EXPECT_EQ(Down(1500, 495), Verdict::kWithhold);
  EXPECT_EQ(Move(1505, 460), Verdict::kTaken);

  ASSERT_FALSE(sink_->taken.empty());
  EXPECT_EQ(sink_->taken[0].edge, NativeGestureEdge::kBottom);
}

// The sink binds no swipe from the right, and nothing lands mid-screen.
TEST_F(EdgeSwipeTest, AFingerAnywhereElseIsThePagesAtOnce) {
  EXPECT_EQ(Down(1995, 200), Verdict::kDispatch);
  EXPECT_EQ(Move(1900, 200), Verdict::kDispatch);
  EXPECT_EQ(Up(1900, 200), Verdict::kDispatch);
  EXPECT_EQ(Down(1500, 200), Verdict::kDispatch);
  EXPECT_EQ(Up(1500, 200), Verdict::kDispatch);

  EXPECT_TRUE(sink_->taken.empty());
}

// Scrolling a list that reaches the screen's edge: along it, not in.
TEST_F(EdgeSwipeTest, AFingerAlongTheEdgeIsThePages) {
  EXPECT_EQ(Down(1010, 100), Verdict::kWithhold);
  EXPECT_EQ(Move(1015, 120), Verdict::kWithhold);
  EXPECT_EQ(Move(1020, 200), Verdict::kRelease);
  EXPECT_EQ(Move(1100, 200), Verdict::kDispatch);
  EXPECT_EQ(Up(1100, 200), Verdict::kDispatch);

  EXPECT_TRUE(sink_->taken.empty());
}

// Nearer the top, which is unbound, than the left, which is bound: still the
// left edge's swipe.
TEST_F(EdgeSwipeTest, InACornerTheNearerBoundEdgeWins) {
  EXPECT_EQ(Down(1012, 3), Verdict::kWithhold);
  EXPECT_EQ(Move(1080, 10), Verdict::kTaken);

  ASSERT_FALSE(sink_->taken.empty());
  EXPECT_EQ(sink_->taken[0].edge, NativeGestureEdge::kLeft);
}

TEST_F(EdgeSwipeTest, ATapAtTheEdgeIsThePages) {
  EXPECT_EQ(Down(1005, 100), Verdict::kWithhold);
  EXPECT_EQ(Up(1005, 100), Verdict::kRelease);

  EXPECT_TRUE(sink_->taken.empty());
  EXPECT_FALSE(swipe_.deadline());
}

// A pinch that starts at the edge.
TEST_F(EdgeSwipeTest, ASecondFingerReleasesTheFirst) {
  EXPECT_EQ(Down(1005, 100), Verdict::kWithhold);
  EXPECT_EQ(Down(1300, 100, 1), Verdict::kRelease);
  EXPECT_EQ(Move(1100, 100), Verdict::kDispatch);
  EXPECT_EQ(Up(1100, 100), Verdict::kDispatch);
  EXPECT_EQ(Up(1300, 100, 1), Verdict::kDispatch);

  EXPECT_TRUE(sink_->taken.empty());
}

// A finger held still at the edge, as to press a button there.
TEST_F(EdgeSwipeTest, AFingerThatWaitsIsThePages) {
  EXPECT_EQ(Down(1005, 100), Verdict::kWithhold);
  ASSERT_TRUE(swipe_.deadline());
  EXPECT_EQ(*swipe_.deadline(), now_ + ui::kEdgeSwipeWait);

  swipe_.Expire();

  EXPECT_FALSE(swipe_.deadline());
  EXPECT_EQ(Move(1100, 100), Verdict::kDispatch);
  EXPECT_EQ(Up(1100, 100), Verdict::kDispatch);
  EXPECT_TRUE(sink_->taken.empty());
}

// A swipe the platform takes back ends canceled, and the next finger starts
// afresh.
TEST_F(EdgeSwipeTest, ACanceledSwipeEndsCanceled) {
  Down(1005, 100);
  Move(1100, 100);
  EXPECT_EQ(Touch(EventType::kTouchCancelled, 0, 1100, 100), Verdict::kTaken);

  ASSERT_EQ(sink_->taken.size(), 3u);
  EXPECT_EQ(sink_->taken[2].phase, NativeGesturePhase::kEnd);
  EXPECT_TRUE(sink_->taken[2].canceled);
  EXPECT_EQ(Down(1005, 100), Verdict::kWithhold);
}

// Another finger during a swipe is the page's; the swipe goes on.
TEST_F(EdgeSwipeTest, AnotherFingerDuringASwipeIsThePages) {
  Down(1005, 100);
  Move(1100, 100);
  EXPECT_EQ(Down(1500, 300, 1), Verdict::kDispatch);
  EXPECT_EQ(Move(1150, 100), Verdict::kTaken);
  EXPECT_EQ(Up(1150, 100), Verdict::kTaken);
  EXPECT_EQ(Move(1550, 300, 1), Verdict::kDispatch);
  EXPECT_EQ(Up(1550, 300, 1), Verdict::kDispatch);
}

}  // namespace
}  // namespace domicile
