// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/download_tally.h"

#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(DownloadTallyTest, NoDownloadsTallyToNothing) {
  EXPECT_EQ(TallyDownloads({}), DownloadTally());
}

TEST(DownloadTallyTest, AddsUpDownloadsInProgress) {
  const std::vector<DownloadReading> downloads = {
      {.in_progress = true,
       .has_target = true,
       .received_bytes = 10,
       .total_bytes = 100},
      {.in_progress = true,
       .has_target = true,
       .received_bytes = 5,
       .total_bytes = 50},
  };
  EXPECT_EQ(
      TallyDownloads(downloads),
      (DownloadTally{.count = 2, .received_bytes = 15, .total_bytes = 150}));
}

TEST(DownloadTallyTest, OneDownloadOfUnknownSizeMakesTheTotalUnknown) {
  // A sum without it would read as nearly done when it is not.
  const std::vector<DownloadReading> downloads = {
      {.in_progress = true,
       .has_target = true,
       .received_bytes = 10,
       .total_bytes = 100},
      {.in_progress = true,
       .has_target = true,
       .received_bytes = 5,
       .total_bytes = 0},
  };
  EXPECT_EQ(
      TallyDownloads(downloads),
      (DownloadTally{.count = 2, .received_bytes = 15, .total_bytes = 0}));
}

TEST(DownloadTallyTest, LeavesOutDownloadsNoLongerInProgress) {
  const std::vector<DownloadReading> downloads = {
      {.in_progress = false,
       .has_target = true,
       .received_bytes = 100,
       .total_bytes = 100},
  };
  EXPECT_EQ(TallyDownloads(downloads), DownloadTally());
}

TEST(DownloadTallyTest, LeavesOutDownloadsTheShellHasNotPlaced) {
  // The shell's picker is still open for it; it fetches meanwhile.
  const std::vector<DownloadReading> downloads = {
      {.in_progress = true,
       .has_target = false,
       .received_bytes = 10,
       .total_bytes = 100},
  };
  EXPECT_EQ(TallyDownloads(downloads), DownloadTally());
}

}  // namespace
}  // namespace domicile
