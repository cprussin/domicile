// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_alpha.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// The four fourccs the engine imports -- FormatFromFourcc in
// brokered_frame_sink.cc, and FOURCCS in the compositor's engine.rs.
constexpr uint32_t kArgb8888 = 0x34325241;
constexpr uint32_t kXrgb8888 = 0x34325258;
constexpr uint32_t kAbgr8888 = 0x34324241;
constexpr uint32_t kXbgr8888 = 0x34324258;

// A menu's rounded corners are transparent pixels in an ARGB buffer. Drawn
// opaque, they are black.
TEST(SurfaceAlphaTest, ABufferWithAlphaIsBlended) {
  EXPECT_TRUE(FourccHasAlpha(kArgb8888));
  EXPECT_TRUE(FourccHasAlpha(kAbgr8888));
}

TEST(SurfaceAlphaTest, ABufferWithoutAlphaIsOpaque) {
  EXPECT_FALSE(FourccHasAlpha(kXrgb8888));
  EXPECT_FALSE(FourccHasAlpha(kXbgr8888));
}

}  // namespace
}  // namespace domicile
