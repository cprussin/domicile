// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_partition.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(WebViewPartitionTest, NoNameIsTheProfilesOwnPartition) {
  EXPECT_EQ(ParseWebViewPartition("").value(),
            std::optional<WebViewPartition>());
}

TEST(WebViewPartitionTest, APersistPrefixKeepsThePartitionOnDisk) {
  EXPECT_EQ(ParseWebViewPartition("persist:work").value(),
            WebViewPartition({.name = "work", .persist = true}));
}

TEST(WebViewPartitionTest, AnyOtherNameIsKeptInMemory) {
  // Only the exact prefix persists, as in Electron.
  EXPECT_EQ(ParseWebViewPartition("work").value(),
            WebViewPartition({.name = "work", .persist = false}));
  EXPECT_EQ(ParseWebViewPartition("Persist:work").value(),
            WebViewPartition({.name = "Persist:work", .persist = false}));
}

TEST(WebViewPartitionTest, APersistPrefixWithNoNameIsRefused) {
  EXPECT_FALSE(ParseWebViewPartition("persist:").has_value());
}

TEST(WebViewPartitionTest, ANameRoundTrips) {
  for (const char* attribute : {"persist:work", "work", "persist:a:b"}) {
    const auto parsed = ParseWebViewPartition(attribute);
    ASSERT_TRUE(parsed.has_value() && parsed->has_value()) << attribute;
    EXPECT_EQ(WebViewPartitionAttribute(**parsed), attribute);
  }
}

}  // namespace
}  // namespace domicile
