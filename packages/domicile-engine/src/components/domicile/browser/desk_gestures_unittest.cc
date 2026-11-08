// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_gestures.h"

#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/types/native_gesture.h"

namespace domicile {
namespace {

using ui::NativeGesture;
using ui::NativeGestureKind;
using ui::NativeGesturePhase;

using Heard = std::vector<NativeGesturePhase>;

DeskGestures::Performed Into(Heard* heard) {
  return base::BindRepeating(
      [](Heard* heard, const NativeGesture& gesture) {
        heard->push_back(gesture.phase);
      },
      base::Unretained(heard));
}

NativeGesture Begin(NativeGestureKind kind, uint32_t fingers) {
  return {.kind = kind, .fingers = fingers};
}

NativeGesture Edge(ui::NativeGestureEdge edge) {
  return {.kind = NativeGestureKind::kEdge, .fingers = 1, .edge = edge};
}

NativeGesture Swipe(NativeGesturePhase phase, uint32_t fingers = 3) {
  return {.kind = NativeGestureKind::kSwipe,
          .phase = phase,
          .fingers = fingers};
}

// The shell binds `swipe:3:…`; a four-finger swipe or a pinch is not it.
TEST(DeskGesturesTest, ItTakesOnlyTheKindAndFingersGrabbed) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kSwipe, 3});

  EXPECT_TRUE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 3)));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 4)));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kPinch, 3)));
}

// `swipe:right`, with no count, is any number of fingers.
TEST(DeskGesturesTest, AGrabOfNoFingerCountTakesAny) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kHold, 0});

  EXPECT_TRUE(gestures.Takes(Begin(NativeGestureKind::kHold, 3)));
  EXPECT_TRUE(gestures.Takes(Begin(NativeGestureKind::kHold, 5)));
}

// Every page grabs the same gestures; one running the binding is enough.
TEST(DeskGesturesTest, OneChannelHearsEveryPhaseOfAGesture) {
  DeskGestures gestures;
  Heard first;
  Heard second;
  const auto one = gestures.AddChannel(Into(&first));
  const auto two = gestures.AddChannel(Into(&second));
  gestures.Grab(one, {NativeGestureKind::kSwipe, 3});
  gestures.Grab(two, {NativeGestureKind::kSwipe, 3});

  gestures.Take(Swipe(NativeGesturePhase::kBegin));
  gestures.Take(Swipe(NativeGesturePhase::kUpdate));
  gestures.Take(Swipe(NativeGesturePhase::kEnd));

  EXPECT_EQ(first, (Heard{NativeGesturePhase::kBegin,
                          NativeGesturePhase::kUpdate,
                          NativeGesturePhase::kEnd}));
  EXPECT_TRUE(second.empty());
}

// The page that took the begin keeps the gesture after giving the grab back,
// so it hears the end its binding waits for.
TEST(DeskGesturesTest, AnUngrabMidGestureStillEndsIt) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kSwipe, 3});
  gestures.Take(Swipe(NativeGesturePhase::kBegin));

  gestures.Ungrab(channel, {NativeGestureKind::kSwipe, 3});
  gestures.Take(Swipe(NativeGesturePhase::kEnd));

  EXPECT_EQ(heard,
            (Heard{NativeGesturePhase::kBegin, NativeGesturePhase::kEnd}));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 3)));
}

// A page that went away mid-gesture hears nothing more, and nobody else does.
TEST(DeskGesturesTest, ARemovedChannelsGestureGoesNowhere) {
  DeskGestures gestures;
  Heard gone;
  Heard other;
  const auto channel = gestures.AddChannel(Into(&gone));
  gestures.AddChannel(Into(&other));
  gestures.Grab(channel, {NativeGestureKind::kSwipe, 3});
  gestures.Take(Swipe(NativeGesturePhase::kBegin));

  gestures.RemoveChannel(channel);
  gestures.Take(Swipe(NativeGesturePhase::kUpdate));
  gestures.Take(Swipe(NativeGesturePhase::kEnd));

  EXPECT_EQ(gone, (Heard{NativeGesturePhase::kBegin}));
  EXPECT_TRUE(other.empty());
}

// Grabbing twice is one grab; the page counts its own.
TEST(DeskGesturesTest, OneUngrabAnswersRepeatedGrabs) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kPinch, 4});
  gestures.Grab(channel, {NativeGestureKind::kPinch, 4});

  gestures.Ungrab(channel, {NativeGestureKind::kPinch, 4});

  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kPinch, 4)));
}

NativeGesture Hold(NativeGesturePhase phase, uint32_t fingers = 3) {
  return {.kind = NativeGestureKind::kHold, .phase = phase, .fingers = fingers};
}

// The shell binds three-finger swipes; a four-finger swipe and a hold go to
// the apps, through the channel that forwards them, and not to the binding.
TEST(DeskGesturesTest, WhatTheShellLeavesIsForwarded) {
  DeskGestures gestures;
  Heard bound;
  Heard unbound;
  const auto channel = gestures.AddChannel(Into(&bound), Into(&unbound));
  gestures.Grab(channel, {NativeGestureKind::kSwipe, 3});

  EXPECT_TRUE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 4)));
  gestures.Take(Swipe(NativeGesturePhase::kBegin, 4));
  gestures.Take(Swipe(NativeGesturePhase::kUpdate, 4));
  gestures.Take(Swipe(NativeGesturePhase::kEnd, 4));
  gestures.Take(Hold(NativeGesturePhase::kBegin));
  gestures.Take(Hold(NativeGesturePhase::kEnd));
  gestures.Take(Swipe(NativeGesturePhase::kBegin));
  gestures.Take(Swipe(NativeGesturePhase::kEnd));

  EXPECT_EQ(unbound,
            (Heard{NativeGesturePhase::kBegin, NativeGesturePhase::kUpdate,
                   NativeGesturePhase::kEnd, NativeGesturePhase::kBegin,
                   NativeGesturePhase::kEnd}));
  EXPECT_EQ(bound,
            (Heard{NativeGesturePhase::kBegin, NativeGesturePhase::kEnd}));
}

// Fewer fingers are pointing and scrolling, and an unbound pinch is the
// page's: none of them is forwarded.
TEST(DeskGesturesTest, PinchesAndFewFingersAreNotForwarded) {
  DeskGestures gestures;
  Heard bound;
  Heard unbound;
  gestures.AddChannel(Into(&bound), Into(&unbound));

  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kPinch, 3)));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 2)));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kHold, 1)));
  EXPECT_FALSE(gestures.Takes(Edge(ui::NativeGestureEdge::kLeft)));
}

// Every page could forward; the compositor needs to hear it once.
TEST(DeskGesturesTest, OneChannelForwardsAGesture) {
  DeskGestures gestures;
  Heard bound;
  Heard first;
  Heard second;
  gestures.AddChannel(Into(&bound));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 3)));

  gestures.AddChannel(Into(&bound), Into(&first));
  gestures.AddChannel(Into(&bound), Into(&second));
  gestures.Take(Hold(NativeGesturePhase::kBegin, 4));
  gestures.Take(Hold(NativeGesturePhase::kEnd, 4));

  EXPECT_EQ(first,
            (Heard{NativeGesturePhase::kBegin, NativeGesturePhase::kEnd}));
  EXPECT_TRUE(second.empty());
  EXPECT_TRUE(bound.empty());
}

// `edge:left` is a finger in from the left only; `edge` from any side.
TEST(DeskGesturesTest, AnEdgeGrabTakesItsEdge) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kEdge, 1,
                          ui::NativeGestureEdge::kLeft});

  EXPECT_TRUE(gestures.Takes(Edge(ui::NativeGestureEdge::kLeft)));
  EXPECT_FALSE(gestures.Takes(Edge(ui::NativeGestureEdge::kRight)));
  EXPECT_FALSE(gestures.Takes(Begin(NativeGestureKind::kSwipe, 1)));

  gestures.Grab(channel, {NativeGestureKind::kEdge, 1, std::nullopt});
  EXPECT_TRUE(gestures.Takes(Edge(ui::NativeGestureEdge::kBottom)));
}

}  // namespace
}  // namespace domicile
