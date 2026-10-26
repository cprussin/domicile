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
  activity.AddListener(base::BindRepeating(
      [](int* heard, std::string* named, const std::string& input) {
        ++*heard;
        *named = input;
      },
      base::Unretained(&left), base::Unretained(&named)));
  activity.AddListener(base::BindRepeating(
      [](int* heard, const std::string&) { ++*heard; },
      base::Unretained(&right)));

  activity.Heard("KeyPressed");

  EXPECT_EQ(left, 1);
  EXPECT_EQ(right, 1);
  EXPECT_EQ(named, "KeyPressed");
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskActivityTest, ARemovedListenerHearsNothing) {
  DeskActivity activity;
  int heard = 0;
  const DeskActivity::ListenerId listener = activity.AddListener(
      base::BindRepeating([](int* count, const std::string&) { ++*count; },
                          base::Unretained(&heard)));

  activity.RemoveListener(listener);
  activity.Heard("KeyPressed");

  EXPECT_EQ(heard, 0);
}

// The compositor logs what restarted its idle clock, so a device that keeps
// the desk awake by itself is named.
TEST(DeskActivityTest, AnInputIsNamedWithTheDeviceItCameFrom) {
  EXPECT_EQ(DescribeInput("MouseMoved", "Logitech USB Receiver"),
            "MouseMoved from Logitech USB Receiver");
  EXPECT_EQ(DescribeInput("KeyPressed", ""), "KeyPressed");
}

}  // namespace
}  // namespace domicile
