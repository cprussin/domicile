// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/aura/domicile/desk_targeter.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace aura {
namespace {

// A 1920x1280 host window whose page is the desk: 5520x3200, with the host
// monitor's corner 1920 down from the page's.
constexpr gfx::Size kRoot(1920, 1280);
constexpr gfx::Rect kPage(0, -1920, 5520, 3200);

TEST(DomicileDeskTargeterTest, APointerOnTheHostIsLeftToAura) {
  EXPECT_EQ(DeskPagePoint(kRoot, kPage, gfx::PointF(100, 100)), std::nullopt);
}

TEST(DomicileDeskTargeterTest, APointerOnAnotherMonitorIsThePages) {
  // To the right of the host, on the next monitor: the page has it, where the
  // page is, though no window between the root and the page reaches that far.
  EXPECT_EQ(DeskPagePoint(kRoot, kPage, gfx::PointF(3000, -1000)),
            gfx::PointF(3000, 920));
}

TEST(DomicileDeskTargeterTest, APointerPastThePageIsNobodys) {
  EXPECT_EQ(DeskPagePoint(kRoot, kPage, gfx::PointF(6000, 100)), std::nullopt);
}

TEST(DomicileDeskTargeterTest, NoPageTakesNothing) {
  EXPECT_EQ(DeskPagePoint(kRoot, gfx::Rect(), gfx::PointF(3000, -1000)),
            std::nullopt);
}

}  // namespace
}  // namespace aura
