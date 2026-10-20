// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/will_navigate.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/page_transition_types.h"

namespace domicile {
namespace {

TEST(WillNavigateTest, ALinkThePageFollowsAsks) {
  EXPECT_TRUE(AsksBeforeNavigating(/*main_frame=*/true,
                                   /*renderer_initiated=*/true,
                                   ui::PAGE_TRANSITION_LINK));
  // `location.href = …` from a timer, or a meta refresh.
  EXPECT_TRUE(AsksBeforeNavigating(
      true, true,
      ui::PageTransitionFromInt(ui::PAGE_TRANSITION_LINK |
                                ui::PAGE_TRANSITION_CLIENT_REDIRECT)));
}

TEST(WillNavigateTest, TheShellsOwnNavigationDoesNotAsk) {
  // `src`, goBack(), reload(): the shell already knows.
  EXPECT_FALSE(AsksBeforeNavigating(true, /*renderer_initiated=*/false,
                                    ui::PAGE_TRANSITION_AUTO_TOPLEVEL));
}

TEST(WillNavigateTest, ASubframeDoesNotAsk) {
  EXPECT_FALSE(AsksBeforeNavigating(/*main_frame=*/false, true,
                                    ui::PAGE_TRANSITION_AUTO_SUBFRAME));
}

TEST(WillNavigateTest, HistoryAndReloadsDoNotAsk) {
  // history.back() and location.reload(), as Electron's will-navigate skips
  // them.
  EXPECT_FALSE(AsksBeforeNavigating(
      true, true,
      ui::PageTransitionFromInt(ui::PAGE_TRANSITION_LINK |
                                ui::PAGE_TRANSITION_FORWARD_BACK)));
  EXPECT_FALSE(AsksBeforeNavigating(true, true, ui::PAGE_TRANSITION_RELOAD));
}

}  // namespace
}  // namespace domicile
