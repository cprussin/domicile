// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_submits.h"

#include <cstdint>
#include <optional>
#include <vector>

#include "gpu/command_buffer/common/command_buffer_id.h"
#include "gpu/command_buffer/common/constants.h"
#include "gpu/command_buffer/common/sync_token.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

SurfaceSubmit SubmitOf(uint64_t buffer) {
  SurfaceSubmit submit;
  submit.buffer = buffer;
  return submit;
}

gpu::SyncToken TokenOf(uint64_t release) {
  return gpu::SyncToken(gpu::CommandBufferNamespace::GPU_IO,
                        gpu::CommandBufferId::FromUnsafeValue(1), release);
}

// The buffers of `submits`, in order.
std::vector<uint64_t> BuffersOf(const std::vector<SurfaceSubmit>& submits) {
  std::vector<uint64_t> buffers;
  for (const SurfaceSubmit& submit : submits) {
    buffers.push_back(submit.buffer);
  }
  return buffers;
}

TEST(SurfaceSubmitsTest, ASubmitWithNothingWaitingGoesAtOnce) {
  SurfaceSubmits submits;
  EXPECT_EQ(BuffersOf(submits.Push(SubmitOf(1))), std::vector<uint64_t>{1});
}

// Viz takes frames in the order they are sent, and the compositor numbers
// them in the order it submits.
TEST(SurfaceSubmitsTest, ALaterSubmitWaitsForAnEarlierFence) {
  SurfaceSubmits submits;
  const uint64_t ticket = submits.Hold(SubmitOf(1));
  EXPECT_TRUE(submits.Push(SubmitOf(2)).empty());

  const std::vector<SurfaceSubmit> ready = submits.Fenced(ticket, TokenOf(7));

  EXPECT_EQ(BuffersOf(ready), (std::vector<uint64_t>{1, 2}));
  EXPECT_EQ(ready[0].sync_token, TokenOf(7));
  EXPECT_FALSE(ready[1].sync_token.HasData());
}

TEST(SurfaceSubmitsTest, FencesPutInPlaceOutOfOrderGoInOrder) {
  SurfaceSubmits submits;
  const uint64_t first = submits.Hold(SubmitOf(1));
  const uint64_t second = submits.Hold(SubmitOf(2));

  EXPECT_TRUE(submits.Fenced(second, TokenOf(8)).empty());
  const std::vector<SurfaceSubmit> ready = submits.Fenced(first, TokenOf(7));

  EXPECT_EQ(BuffersOf(ready), (std::vector<uint64_t>{1, 2}));
  EXPECT_EQ(ready[0].sync_token, TokenOf(7));
  EXPECT_EQ(ready[1].sync_token, TokenOf(8));
}

// Its buffer may be unfinished, so viz must not sample it.
TEST(SurfaceSubmitsTest, ARefusedFenceComesBackRefused) {
  SurfaceSubmits submits;
  const uint64_t ticket = submits.Hold(SubmitOf(1));

  const std::vector<SurfaceSubmit> ready =
      submits.Fenced(ticket, std::nullopt);

  ASSERT_EQ(BuffersOf(ready), std::vector<uint64_t>{1});
  EXPECT_TRUE(ready[0].fence_refused);
  EXPECT_EQ(BuffersOf(submits.Push(SubmitOf(2))), std::vector<uint64_t>{2});
}

}  // namespace
}  // namespace domicile
