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

  EXPECT_TRUE(gestures.Takes(NativeGestureKind::kSwipe, 3));
  EXPECT_FALSE(gestures.Takes(NativeGestureKind::kSwipe, 4));
  EXPECT_FALSE(gestures.Takes(NativeGestureKind::kPinch, 3));
}

// `swipe:right`, with no count, is any number of fingers.
TEST(DeskGesturesTest, AGrabOfNoFingerCountTakesAny) {
  DeskGestures gestures;
  Heard heard;
  const auto channel = gestures.AddChannel(Into(&heard));
  gestures.Grab(channel, {NativeGestureKind::kHold, 0});

  EXPECT_TRUE(gestures.Takes(NativeGestureKind::kHold, 3));
  EXPECT_TRUE(gestures.Takes(NativeGestureKind::kHold, 5));
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
  EXPECT_FALSE(gestures.Takes(NativeGestureKind::kSwipe, 3));
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

  EXPECT_FALSE(gestures.Takes(NativeGestureKind::kPinch, 4));
}

}  // namespace
}  // namespace domicile
