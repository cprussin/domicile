// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/synced_frame.h"

#include "base/unguessable_token.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

const base::UnguessableToken& Token() {
  static const base::UnguessableToken token = base::UnguessableToken::Create();
  return token;
}

TEST(SyncedFrameTest, FrameZeroIsTheAllocatedId) {
  const viz::LocalSurfaceId allocated(3, Token());
  EXPECT_EQ(AtSyncedFrame(allocated, 0), allocated);
}

// The producer and the page each apply the number, so both name one id.
TEST(SyncedFrameTest, AFrameBumpsTheChildSequenceOnly) {
  EXPECT_EQ(
      AtSyncedFrame(viz::LocalSurfaceId(3, Token()), 2),
      viz::LocalSurfaceId(3, viz::kInitialChildSequenceNumber + 2, Token()));
}

// Viz refuses a submit whose id is not newer than the last.
TEST(SyncedFrameTest, EachFrameIsNewerThanTheLast) {
  const viz::LocalSurfaceId allocated(3, Token());
  EXPECT_TRUE(
      AtSyncedFrame(allocated, 2).IsNewerThan(AtSyncedFrame(allocated, 1)));
}

// A resize after a synced frame must not decrease the child sequence.
TEST(SyncedFrameTest, AResizeAtTheSameFrameIsNewer) {
  EXPECT_TRUE(
      AtSyncedFrame(viz::LocalSurfaceId(4, Token()), 2)
          .IsNewerThan(AtSyncedFrame(viz::LocalSurfaceId(3, Token()), 2)));
}

}  // namespace
}  // namespace domicile
