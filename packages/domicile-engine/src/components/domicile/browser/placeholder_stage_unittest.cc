// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/placeholder_stage.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

TEST(PlaceholderStageTest, AFrameTheBrowserHasNotSeenIsAbsent) {
  EXPECT_EQ(StageOf(/*frame_exists=*/false, GURL()),
            PlaceholderStage::kAbsent);
}

TEST(PlaceholderStageTest, AFrameWhoseBlankPageHasNotArrivedIsCommitting) {
  // The frame is announced, but its synchronous about:blank commit is still on
  // the frame's channel. Attaching now makes that commit land in an outer
  // delegate frame, which took the browser down in PageLoadMetrics.
  EXPECT_EQ(StageOf(/*frame_exists=*/true, GURL()),
            PlaceholderStage::kCommitting);
}

TEST(PlaceholderStageTest, AFrameOnItsBlankPageIsReady) {
  EXPECT_EQ(StageOf(/*frame_exists=*/true, GURL("about:blank")),
            PlaceholderStage::kReady);
}

}  // namespace
}  // namespace domicile
