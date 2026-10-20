// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity.h"

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Every control channel hears it: there is one per monitor's shell page.
TEST(DeskActivityTest, EveryListenerHearsSomebodyAtTheDesk) {
  DeskActivity activity;
  int left = 0;
  int right = 0;
  activity.AddListener(base::BindRepeating([](int* heard) { ++*heard; },
                                           base::Unretained(&left)));
  activity.AddListener(base::BindRepeating([](int* heard) { ++*heard; },
                                           base::Unretained(&right)));

  activity.Heard();

  EXPECT_EQ(left, 1);
  EXPECT_EQ(right, 1);
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskActivityTest, ARemovedListenerHearsNothing) {
  DeskActivity activity;
  int heard = 0;
  const DeskActivity::ListenerId listener = activity.AddListener(
      base::BindRepeating([](int* count) { ++*count; },
                          base::Unretained(&heard)));

  activity.RemoveListener(listener);
  activity.Heard();

  EXPECT_EQ(heard, 0);
}

}  // namespace
}  // namespace domicile
