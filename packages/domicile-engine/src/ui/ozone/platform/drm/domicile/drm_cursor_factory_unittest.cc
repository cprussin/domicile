// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

  // NOTHING IS WHAT SENDS `CursorLoader` TO THE BITMAPS. It asks the platform
  // first and returns any non-null answer as the cursor, so the arrow art in
  // `ui_lottie_resources` is reached only past a null from here. The base
  // class answers a typed, bitmapless cursor instead, and a CRTC handed one
  // of those is handed `drmModeSetCursor(..., 0, 0, 0)`, which turns the
  // cursor plane off.
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

  // `CursorLoader` routes `kNone` through the platform whatever
  // `use_platform_cursors_` says, and `DrmCursor::SendCursorShowLocked` reads
  // `type() == kNone` as "hide". Answering nothing here would send the loader
  // to assets that have no art for an invisible cursor and fall back to the
  // pointer -- an arrow drawn exactly where something asked for no cursor.
  const scoped_refptr<PlatformCursor> none =
      factory.GetDefaultCursor(mojom::CursorType::kNone);

  ASSERT_NE(none, nullptr);
  EXPECT_EQ(BitmapCursor::FromPlatformCursor(none)->type(),
            mojom::CursorType::kNone);
  EXPECT_TRUE(BitmapCursor::FromPlatformCursor(none)->bitmaps().empty());
}

TEST(DrmCursorFactoryTest, TheScaledOverloadAnswersTheSameWay) {
  DrmCursorFactory concrete;

  // HELD AS THE BASE, BECAUSE THAT IS HOW `CursorLoader` HOLDS IT
  // (`factory_` is a `CursorFactory*`) and because the two-argument overload
  // is the one it calls. `CursorFactory` forwards that to the one-argument
  // one unless a backend replaces it; this class replaces only the one, so
  // the forward is what carries the whole change -- and an override of the
  // other would silently undo it.
  CursorFactory& factory = concrete;

  EXPECT_EQ(factory.GetDefaultCursor(mojom::CursorType::kPointer, 2.0f),
            nullptr);
  EXPECT_NE(factory.GetDefaultCursor(mojom::CursorType::kNone, 2.0f), nullptr);

  // And the same through the derived type, which is a different question:
  // declaring one overload hides the rest, so this line does not compile
  // without the `using` in the header.
  EXPECT_EQ(concrete.GetDefaultCursor(mojom::CursorType::kPointer, 2.0f),
            nullptr);
}

TEST(DrmCursorFactoryTest, AnImageCursorIsStillMade) {
  DrmCursorFactory factory;

  // The image path is untouched, and has to be: a client's own cursor over an
  // `<app>` and every CSS `cursor` a shell sets arrive as bitmaps rather than
  // as types, and they never go through `GetDefaultCursor` at all.
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
