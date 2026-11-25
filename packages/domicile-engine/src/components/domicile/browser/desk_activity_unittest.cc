// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity.h"

#include <string>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Every control channel hears it: there is one per monitor's shell page.
TEST(DeskActivityTest, EveryListenerHearsSomebodyAtTheDesk) {
  DeskActivity activity;
  int left = 0;
  int right = 0;
  std::string named;
  ActivityKind of = ActivityKind::kOther;
  activity.AddListener(base::BindRepeating(
      [](int* heard, std::string* named, ActivityKind* of,
         const std::string& input, ActivityKind kind) {
        ++*heard;
        *named = input;
        *of = kind;
      },
      base::Unretained(&left), base::Unretained(&named),
      base::Unretained(&of)));
  activity.AddListener(base::BindRepeating(
      [](int* heard, const std::string&, ActivityKind) { ++*heard; },
      base::Unretained(&right)));

  activity.Heard("KeyPressed", ActivityKind::kKey);

  EXPECT_EQ(left, 1);
  EXPECT_EQ(right, 1);
  EXPECT_EQ(named, "KeyPressed");
  EXPECT_EQ(of, ActivityKind::kKey);
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskActivityTest, ARemovedListenerHearsNothing) {
  DeskActivity activity;
  int heard = 0;
  const DeskActivity::ListenerId listener =
      activity.AddListener(base::BindRepeating(
          [](int* count, const std::string&, ActivityKind) { ++*count; },
          base::Unretained(&heard)));

  activity.RemoveListener(listener);
  activity.Heard("KeyPressed", ActivityKind::kKey);

  EXPECT_EQ(heard, 0);
}

// The compositor logs what restarted its idle clock, so a device that keeps
// the desk awake by itself is named.
TEST(DeskActivityTest, AnInputIsNamedWithTheDeviceItCameFrom) {
  EXPECT_EQ(DescribeInput("MouseMoved", "Logitech USB Receiver"),
            "MouseMoved from Logitech USB Receiver");
  EXPECT_EQ(DescribeInput("KeyPressed", ""), "KeyPressed");
}

// The compositor parses these names.
TEST(DeskActivityTest, AKindIsNamedAsTheCompositorReadsIt) {
  EXPECT_EQ(ActivityKindName(ActivityKind::kKey), "key");
  EXPECT_EQ(ActivityKindName(ActivityKind::kPointer), "pointer");
  EXPECT_EQ(ActivityKindName(ActivityKind::kPointerMotion), "pointer_motion");
  EXPECT_EQ(ActivityKindName(ActivityKind::kTouch), "touch");
  EXPECT_EQ(ActivityKindName(ActivityKind::kOther), "other");
}

}  // namespace
}  // namespace domicile
