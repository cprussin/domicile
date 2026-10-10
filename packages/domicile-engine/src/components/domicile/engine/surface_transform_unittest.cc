// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_transform.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// A box wider than it is tall, so a quad that is not turned shows.
constexpr gfx::Size kBox(400, 300);

// Where the buffer's top-left and bottom-right texels land in the box.
struct Corners {
  gfx::Point top_left;
  gfx::Point bottom_right;
};

Corners CornersInBox(BufferTransform transform) {
  const BufferQuad quad = QuadForBuffer(transform, kBox);
  return {quad.to_box.MapPoint(quad.rect.origin()),
          quad.to_box.MapPoint(quad.rect.bottom_right())};
}

TEST(SurfaceTransformTest, AnUnturnedBufferFillsTheBoxAsItIs) {
  const BufferQuad quad = QuadForBuffer(BufferTransform::kNormal, kBox);
  EXPECT_EQ(quad.rect, gfx::Rect(kBox));
  EXPECT_TRUE(quad.to_box.IsIdentity());
}

// A buffer drawn for a quarter turn is the box's height across.
TEST(SurfaceTransformTest, AQuarterTurnedBufferIsTheBoxOnItsSide) {
  EXPECT_EQ(QuadForBuffer(BufferTransform::kRotate90, kBox).rect,
            gfx::Rect(300, 400));
  EXPECT_EQ(QuadForBuffer(BufferTransform::kRotate270, kBox).rect,
            gfx::Rect(300, 400));
  EXPECT_EQ(QuadForBuffer(BufferTransform::kFlipped90, kBox).rect,
            gfx::Rect(300, 400));
  EXPECT_EQ(QuadForBuffer(BufferTransform::kFlipped270, kBox).rect,
            gfx::Rect(300, 400));
  EXPECT_EQ(QuadForBuffer(BufferTransform::kRotate180, kBox).rect,
            gfx::Rect(kBox));
  EXPECT_EQ(QuadForBuffer(BufferTransform::kFlipped, kBox).rect,
            gfx::Rect(kBox));
}

// Each corner follows wl_surface.set_buffer_transform, as Weston maps a
// surface point to a buffer point (weston_transformed_coord).
TEST(SurfaceTransformTest, EachTurnPutsTheBuffersCornersWhereWaylandSays) {
  const auto expect = [](BufferTransform transform, gfx::Point top_left,
                         gfx::Point bottom_right) {
    const Corners corners = CornersInBox(transform);
    EXPECT_EQ(corners.top_left, top_left) << static_cast<int>(transform);
    EXPECT_EQ(corners.bottom_right, bottom_right)
        << static_cast<int>(transform);
  };
  expect(BufferTransform::kNormal, {0, 0}, {400, 300});
  expect(BufferTransform::kRotate90, {0, 300}, {400, 0});
  expect(BufferTransform::kRotate180, {400, 300}, {0, 0});
  expect(BufferTransform::kRotate270, {400, 0}, {0, 300});
  expect(BufferTransform::kFlipped, {400, 0}, {0, 300});
  expect(BufferTransform::kFlipped90, {400, 300}, {0, 0});
  expect(BufferTransform::kFlipped180, {0, 300}, {400, 0});
  expect(BufferTransform::kFlipped270, {0, 0}, {400, 300});
}

}  // namespace
}  // namespace domicile
