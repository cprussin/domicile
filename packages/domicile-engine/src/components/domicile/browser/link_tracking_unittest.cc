// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/link_tracking.h"

#include <optional>
#include <string>
#include <string_view>

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

std::optional<std::string> Without(std::string_view url, bool strict) {
  const std::optional<GURL> without = WithoutTracking(GURL(url), strict);
  if (!without.has_value()) {
    return std::nullopt;
  }
  return without->spec();
}

TEST(LinkTrackingTest, DropsAClickIdAndKeepsTheRestInOrder) {
  EXPECT_EQ(Without("https://example.com/a?b=1&fbclid=x&c=%20&utm_source=n#f",
                    /*strict=*/false),
            "https://example.com/a?b=1&c=%20&utm_source=n#f");
}

TEST(LinkTrackingTest, StrictDropsTheCampaignOnesToo) {
  EXPECT_EQ(Without("https://example.com/?utm_source=n&utm_medium=m&keep=1&"
                    "gclid=g",
                    /*strict=*/true),
            "https://example.com/?keep=1");
}

TEST(LinkTrackingTest, DropsTheQueryWhenNothingIsLeft) {
  EXPECT_EQ(Without("https://example.com/p?fbclid=x&msclkid=y", false),
            "https://example.com/p");
}

TEST(LinkTrackingTest, LeavesAnAddressWithNoneAlone) {
  EXPECT_EQ(Without("https://example.com/p?q=fbclid&FBCLID=x&utm_x=1", false),
            std::nullopt);
  EXPECT_EQ(Without("https://example.com/p", true), std::nullopt);
  EXPECT_EQ(Without("ftp://example.com/p?fbclid=x", true), std::nullopt);
}

}  // namespace
}  // namespace domicile
