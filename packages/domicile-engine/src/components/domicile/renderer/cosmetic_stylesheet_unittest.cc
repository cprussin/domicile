// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/cosmetic_stylesheet.h"

#include <string>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(CosmeticStylesheetTest, HidesEachSelectorInARuleOfItsOwn) {
  EXPECT_EQ(CosmeticStylesheetOf({".ad", "div[data-ad]"}),
            ".ad{display:none !important}\n"
            "div[data-ad]{display:none !important}\n");
}

TEST(CosmeticStylesheetTest, DropsASelectorThatWouldEndItsRule) {
  EXPECT_EQ(CosmeticStylesheetOf(
                {".ad{color:red}", "", "body}html{display:none", "#x"}),
            "#x{display:none !important}\n");
}

TEST(CosmeticStylesheetTest, SplitsAClassAttributeOnWhitespace) {
  EXPECT_EQ(ClassesOf("  ad\tbanner\n top "),
            (std::vector<std::string>{"ad", "banner", "top"}));
  EXPECT_TRUE(ClassesOf(" \t").empty());
}

}  // namespace
}  // namespace domicile
