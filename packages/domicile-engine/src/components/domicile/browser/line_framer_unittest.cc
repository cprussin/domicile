// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
  // The socket is read sixteen kilobytes at a time and a line is as long as
  // the compositor made it, so most of a long one arrives with no newline in
  // it at all.
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
  // THE CASE THIS EXISTS FOR. The reader this replaced searched everything it
  // was holding for a newline on every read, so a line of N reads cost N
  // searches of up to N reads each: tens of megabytes of file list, sixteen
  // kilobytes at a time, was seconds of the IO thread per message. What is
  // asserted is the line; that each byte is looked at once is the
  // implementation's to keep.
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
