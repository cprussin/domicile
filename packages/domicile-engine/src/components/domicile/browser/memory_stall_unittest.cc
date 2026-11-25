// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/memory_stall.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(StalledPercentTest, ReadsSomeTasksLastTenSeconds) {
  EXPECT_EQ(
      StalledPercent("some avg10=12.50 avg60=3.10 avg300=0.40 total=1234\n"
                     "full avg10=99.00 avg60=2.00 avg300=0.20 total=567\n"),
      12.5);
}

TEST(StalledPercentTest, ReadsNoneFromOtherText) {
  EXPECT_EQ(StalledPercent(""), std::nullopt);
  EXPECT_EQ(StalledPercent("full avg10=99.00 avg60=2.00\n"), std::nullopt);
}

TEST(StalledPercentTest, ReadsNoneFromAnAverageThatIsNoNumber) {
  EXPECT_EQ(StalledPercent("some avg10= avg60=3.10\n"), std::nullopt);
  EXPECT_EQ(StalledPercent("some avg10=12.5x avg60=3.10\n"), std::nullopt);
}

}  // namespace
}  // namespace domicile
