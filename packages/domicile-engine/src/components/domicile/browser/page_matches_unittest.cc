// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/page_matches.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(PageMatchesTest, TheScriptCountsTheSelectorsMatches) {
  EXPECT_EQ(CountMatchesScript("[data-unread=true]"),
            u"document.querySelectorAll(\"[data-unread=true]\").length");
}

TEST(PageMatchesTest, NoSelectorEndsTheCall) {
  // A quote and a backslash are escaped, so the selector stays one string.
  EXPECT_EQ(CountMatchesScript("a\"), alert(1), (\"\\"),
            u"document.querySelectorAll("
            u"\"a\\\"), alert(1), (\\\"\\\\\").length");
}

TEST(PageMatchesTest, ANumberIsTheCount) {
  EXPECT_EQ(CountFrom(base::Value(3)), std::make_optional(3));
}

TEST(PageMatchesTest, AnythingElseIsNoAnswer) {
  // A script that threw, or a page that went, answers with no value.
  EXPECT_EQ(CountFrom(base::Value()), std::nullopt);
  EXPECT_EQ(CountFrom(base::Value("3")), std::nullopt);
}

}  // namespace
}  // namespace domicile
