// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_crop.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

TEST(SurfaceCropTest, AnEmptyCropIsTheWholeBuffer) {
  EXPECT_EQ(CropToUv(gfx::Rect(), gfx::Size(850, 650)),
            gfx::RectF(0.f, 0.f, 1.f, 1.f));
}

// A client that draws its own shadow: the window is the middle of the buffer,
// and only the middle fills the <app> element's box.
TEST(SurfaceCropTest, ACropIsItsShareOfTheBuffer) {
  EXPECT_EQ(CropToUv(gfx::Rect(25, 25, 800, 600), gfx::Size(850, 650)),
            gfx::RectF(25.f / 850.f, 25.f / 650.f, 800.f / 850.f,
                       600.f / 650.f));
}

// Nothing to divide by is a buffer the browser never imported; drawing it
// whole is drawing nothing.
TEST(SurfaceCropTest, ABufferOfNothingIsShownWhole) {
  EXPECT_EQ(CropToUv(gfx::Rect(25, 25, 800, 600), gfx::Size()),
            gfx::RectF(0.f, 0.f, 1.f, 1.f));
}

}  // namespace
}  // namespace domicile
