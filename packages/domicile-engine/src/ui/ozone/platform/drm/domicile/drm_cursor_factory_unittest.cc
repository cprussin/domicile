// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_cursor_factory.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/cursor/cursor_factory.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/gfx/geometry/point.h"
#include "ui/ozone/common/bitmap_cursor.h"

namespace ui {
namespace {

TEST(DrmCursorFactoryTest, EveryOrdinaryCursorIsAnsweredWithNothing) {
  DrmCursorFactory factory;

  // Null makes `CursorLoader` load the art from `ui_lottie_resources`. The
  // base's bitmapless cursor would turn the cursor plane off.
  for (const mojom::CursorType type : {
           mojom::CursorType::kPointer,
           mojom::CursorType::kHand,
           mojom::CursorType::kIBeam,
           mojom::CursorType::kWait,
           mojom::CursorType::kNorthWestSouthEastResize,
       }) {
    EXPECT_EQ(factory.GetDefaultCursor(type), nullptr)
        << "cursor type " << static_cast<int>(type);
  }
}

TEST(DrmCursorFactoryTest, TheInvisibleCursorIsStillAnObjectWithAType) {
  DrmCursorFactory factory;

  // `CursorLoader` always asks the platform for `kNone`, and `DrmCursor`
  // hides the cursor on that type. Null would show an arrow instead.
  const scoped_refptr<PlatformCursor> none =
      factory.GetDefaultCursor(mojom::CursorType::kNone);

  ASSERT_NE(none, nullptr);
  EXPECT_EQ(BitmapCursor::FromPlatformCursor(none)->type(),
            mojom::CursorType::kNone);
  EXPECT_TRUE(BitmapCursor::FromPlatformCursor(none)->bitmaps().empty());
}

TEST(DrmCursorFactoryTest, TheScaledOverloadAnswersTheSameWay) {
  DrmCursorFactory concrete;

  // Held as the base and called with a scale, as `CursorLoader` does. This
  // relies on the base forwarding to the one-argument override.
  CursorFactory& factory = concrete;

  EXPECT_EQ(factory.GetDefaultCursor(mojom::CursorType::kPointer, 2.0f),
            nullptr);
  EXPECT_NE(factory.GetDefaultCursor(mojom::CursorType::kNone, 2.0f), nullptr);

  // Through the derived type, this compiles only with the header's `using`.
  EXPECT_EQ(concrete.GetDefaultCursor(mojom::CursorType::kPointer, 2.0f),
            nullptr);
}

TEST(DrmCursorFactoryTest, AnImageCursorIsStillMade) {
  DrmCursorFactory factory;

  // Image cursors still work: app cursors and CSS `cursor` values arrive as
  // bitmaps and bypass `GetDefaultCursor`.
  SkBitmap bitmap;
  bitmap.allocN32Pixels(4, 4);
  bitmap.eraseColor(SK_ColorRED);

  const scoped_refptr<PlatformCursor> image = factory.CreateImageCursor(
      mojom::CursorType::kCustom, bitmap, gfx::Point(1, 1), 1.0f);

  ASSERT_NE(image, nullptr);
  EXPECT_FALSE(BitmapCursor::FromPlatformCursor(image)->bitmaps().empty());
}

}  // namespace
}  // namespace ui
