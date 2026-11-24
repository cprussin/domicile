// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_holds.h"

#include <optional>
#include <vector>

#include "gpu/command_buffer/common/sync_token.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// A token on viz's GPU stream `stream`, `release` steps in.
gpu::SyncToken ReadDoneOn(uint64_t stream, uint64_t release) {
  return gpu::SyncToken(gpu::CommandBufferNamespace::GPU_IO,
                        gpu::CommandBufferId::FromUnsafeValue(stream), release);
}

// The one token viz returns a buffer it read on its first stream with.
std::vector<gpu::SyncToken> ReadDoneAt(uint64_t release) {
  return {ReadDoneOn(/*stream=*/1, release)};
}

TEST(SurfaceHoldsTest, ABufferVizNeverHadGoesAtOnce) {
  SurfaceHolds holds;
  EXPECT_EQ(holds.Destroyed(/*buffer=*/1), std::vector<gpu::SyncToken>());
}

// A client may destroy a buffer viz still draws, such as its old-size buffers
// on resize. Dropped then, viz draws its fallback image in its place.
TEST(SurfaceHoldsTest, ABufferVizHoldsGoesOnceVizReturnsIt) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  EXPECT_EQ(holds.Destroyed(1), std::nullopt);
  EXPECT_EQ(holds.Returned(1, /*count=*/1, ReadDoneAt(1)),
            SurfaceHolds::Return::kDestroy);
}

// Viz returns a buffer before its GPU is done reading it. Dropped before that
// read, the read finds no image and viz draws its fallback image, which stays
// until the client draws again: a still window stays white.
TEST(SurfaceHoldsTest, AReleasedBufferGoesAfterVizsReadOfIt) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  EXPECT_EQ(holds.Returned(1, /*count=*/1, ReadDoneAt(7)),
            SurfaceHolds::Return::kRelease);
  EXPECT_EQ(holds.Destroyed(1), ReadDoneAt(7));
}

// Viz returns a buffer it read on several GPU streams with a token for each.
// Dropped after only one, another read finds no image.
TEST(SurfaceHoldsTest, ABufferReadOnSeveralStreamsGoesAfterEveryRead) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  const std::vector<gpu::SyncToken> read_done = {
      ReadDoneOn(/*stream=*/1, /*release=*/7),
      ReadDoneOn(/*stream=*/2, /*release=*/3)};
  holds.Returned(1, /*count=*/1, read_done);
  EXPECT_EQ(holds.Destroyed(1), read_done);
}

TEST(SurfaceHoldsTest, ABufferSentAgainGoesAfterItsLatestRead) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  holds.Returned(1, /*count=*/1, ReadDoneAt(7));
  holds.Sent(1);
  holds.Returned(1, /*count=*/1, ReadDoneAt(9));
  EXPECT_EQ(holds.Destroyed(1), ReadDoneAt(9));
}

// Viz returns a buffer once per run of holds, so one sent after a return
// still holds it.
TEST(SurfaceHoldsTest, ADestroyedBufferWaitsForEveryHold) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  holds.Sent(1);
  EXPECT_EQ(holds.Destroyed(1), std::nullopt);
  EXPECT_EQ(holds.Returned(1, /*count=*/1, ReadDoneAt(1)),
            SurfaceHolds::Return::kKeep);
  EXPECT_EQ(holds.Returned(1, /*count=*/1, ReadDoneAt(2)),
            SurfaceHolds::Return::kDestroy);
}

}  // namespace
}  // namespace domicile
