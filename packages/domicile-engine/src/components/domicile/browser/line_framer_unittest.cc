// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/line_framer.h"

#include <string>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Lines = std::vector<std::string>;

TEST(LineFramerTest, SeveralLinesInOneReadAreEachTheirOwn) {
  LineFramer framer;

  EXPECT_EQ(framer.Take("{\"a\":1}\n{\"b\":2}\n"),
            (Lines{"{\"a\":1}", "{\"b\":2}"}));
}

TEST(LineFramerTest, ALineCutAcrossReadsIsHeldUntilItEnds) {
  // The socket is read 16 KiB at a time, so long lines span many reads.
  LineFramer framer;

  EXPECT_EQ(framer.Take("{\"type\":"), Lines{});
  EXPECT_EQ(framer.Take("\"theme\""), Lines{});
  EXPECT_EQ(framer.Take("}\n{\"ne"), Lines{"{\"type\":\"theme\"}"});
  EXPECT_EQ(framer.Take("xt\":1}\n"), Lines{"{\"next\":1}"});
}

TEST(LineFramerTest, AnEmptyLineIsALineAndTheCallerDecidesWhatItMeans) {
  LineFramer framer;

  EXPECT_EQ(framer.Take("\n\n"), (Lines{"", ""}));
}

TEST(LineFramerTest, ALineOfManyReadsComesOutWhole) {
  // Large messages, such as file lists, can be tens of megabytes. The test
  // checks the result; linear scanning is up to the implementation.
  LineFramer framer;
  const std::string chunk(16 * 1024, 'x');

  for (int read = 0; read < 256; ++read) {
    ASSERT_EQ(framer.Take(chunk), Lines{});
  }
  const Lines lines = framer.Take("\n");

  ASSERT_EQ(lines.size(), 1u);
  EXPECT_EQ(lines[0].size(), chunk.size() * 256);
}

}  // namespace
}  // namespace domicile
