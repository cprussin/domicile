// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/desk_cursor_image.h"

#include <stdint.h>

#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

namespace ui {
namespace {

using Heard = std::vector<DeskCursorImage>;

DeskCursorImageSource::Changed Into(Heard* heard) {
  return base::BindRepeating(
      [](Heard* heard, const DeskCursorImage& image) {
        heard->push_back(image);
      },
      base::Unretained(heard));
}

DeskCursorImage Pixel(uint8_t blue) {
  DeskCursorImage image;
  image.size = gfx::Size(1, 1);
  image.bgra = {blue, 0, 0, 255};
  return image;
}

// The compositor draws the pointer from these bytes, in the order a
// `Bgra` frame holds them.
TEST(DeskCursorImageTest, ABitmapIsReadAsPremultipliedBgra) {
  SkBitmap bitmap;
  bitmap.allocN32Pixels(2, 1);
  bitmap.eraseColor(SK_ColorTRANSPARENT);
  *bitmap.getAddr32(0, 0) = SkPreMultiplyColor(SkColorSetARGB(255, 1, 2, 3));
  *bitmap.getAddr32(1, 0) =
      SkPreMultiplyColor(SkColorSetARGB(128, 255, 255, 255));

  const DeskCursorImage image = DeskCursorImageOf(bitmap, gfx::Point(1, 0), 2);

  EXPECT_EQ(image.size, gfx::Size(2, 1));
  EXPECT_EQ(image.hotspot, gfx::Point(1, 0));
  EXPECT_EQ(image.scale, 2);
  EXPECT_EQ(image.bgra,
            (std::vector<uint8_t>{3, 2, 1, 255, 128, 128, 128, 128}));
}

// `DrmCursor` hides the pointer with an empty cursor, as for `kNone`.
TEST(DeskCursorImageTest, AnEmptyBitmapIsAHiddenPointer) {
  EXPECT_TRUE(DeskCursorImageOf(SkBitmap(), gfx::Point(), 1).hidden());
  EXPECT_FALSE(Pixel(0).hidden());
}

// Every control channel hears it: there is one per shell page.
TEST(DeskCursorImageSourceTest, EveryListenerHearsEachChange) {
  DeskCursorImageSource source;
  Heard left;
  Heard right;
  source.AddListener(Into(&left));
  source.AddListener(Into(&right));

  source.Set(Pixel(1));
  source.Set(DeskCursorImage());

  const Heard expected{Pixel(1), DeskCursorImage()};
  EXPECT_EQ(left, expected);
  EXPECT_EQ(right, expected);
}

// Each monitor's window sets the pointer; the compositor hears it once.
TEST(DeskCursorImageSourceTest, TheSameImageAgainTellsNobody) {
  DeskCursorImageSource source;
  Heard heard;
  source.AddListener(Into(&heard));

  source.Set(Pixel(1));
  source.Set(Pixel(1));
  source.Set(Pixel(2));

  EXPECT_EQ(heard, (Heard{Pixel(1), Pixel(2)}));
}

// A compositor that connects later is sent the pointer as it is.
TEST(DeskCursorImageSourceTest, TheCurrentImageIsKept) {
  DeskCursorImageSource source;
  EXPECT_EQ(source.current(), std::nullopt);

  source.Set(Pixel(1));

  EXPECT_EQ(source.current(), Pixel(1));
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskCursorImageSourceTest, ARemovedListenerHearsNothing) {
  DeskCursorImageSource source;
  Heard heard;
  const DeskCursorImageSource::ListenerId id = source.AddListener(Into(&heard));

  source.RemoveListener(id);
  source.Set(Pixel(1));

  EXPECT_TRUE(heard.empty());
}

}  // namespace
}  // namespace ui
