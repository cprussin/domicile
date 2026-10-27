// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk_cursors.h"

#include "base/memory/scoped_refptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/cursor/platform_cursor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

namespace ui {
namespace {

TEST(HeadlessDeskCursorsTest, ATypeIsLeftToChromiumsArt) {
  HeadlessDeskCursorFactory factory;

  EXPECT_EQ(factory.GetDefaultCursor(mojom::CursorType::kPointer), nullptr);
  EXPECT_EQ(factory.GetDefaultCursor(mojom::CursorType::kIBeam, 2), nullptr);
}

TEST(HeadlessDeskCursorsTest, NoneHidesThePointer) {
  HeadlessDeskCursorFactory factory;

  scoped_refptr<PlatformCursor> none =
      factory.GetDefaultCursor(mojom::CursorType::kNone);

  ASSERT_NE(none, nullptr);
  EXPECT_TRUE(HeadlessDeskCursorImage(none.get()).hidden());
}

TEST(HeadlessDeskCursorsTest, AnImageCursorIsCastAsItsImage) {
  HeadlessDeskCursorFactory factory;
  SkBitmap bitmap;
  bitmap.allocN32Pixels(4, 6);
  bitmap.eraseColor(SK_ColorRED);

  scoped_refptr<PlatformCursor> cursor = factory.CreateImageCursor(
      mojom::CursorType::kCustom, bitmap, gfx::Point(1, 2), 2);
  const DeskCursorImage image = HeadlessDeskCursorImage(cursor.get());

  EXPECT_EQ(image.size, gfx::Size(4, 6));
  EXPECT_EQ(image.hotspot, gfx::Point(1, 2));
  EXPECT_EQ(image.scale, 2);
  EXPECT_EQ(image.bgra.size(), 4u * 6u * 4u);
}

TEST(HeadlessDeskCursorsTest, NoCursorIsHidden) {
  EXPECT_TRUE(HeadlessDeskCursorImage(nullptr).hidden());
}

}  // namespace
}  // namespace ui
