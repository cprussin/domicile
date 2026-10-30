// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/desk_cursor_image.h"

#include <algorithm>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/no_destructor.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkImageInfo.h"

namespace ui {

DeskCursorImage::DeskCursorImage() = default;
DeskCursorImage::DeskCursorImage(const DeskCursorImage&) = default;
DeskCursorImage::DeskCursorImage(DeskCursorImage&&) = default;
DeskCursorImage& DeskCursorImage::operator=(const DeskCursorImage&) = default;
DeskCursorImage& DeskCursorImage::operator=(DeskCursorImage&&) = default;
DeskCursorImage::~DeskCursorImage() = default;

DeskCursorImage DeskCursorImageOf(const SkBitmap& bitmap,
                                  const gfx::Point& hotspot,
                                  float scale) {
  DeskCursorImage image;
  if (bitmap.drawsNothing()) {
    return image;
  }
  // Read out as premultiplied BGRA whatever the bitmap holds, since that is
  // what the compositor's casts draw.
  const SkImageInfo info =
      SkImageInfo::Make(bitmap.width(), bitmap.height(), kBGRA_8888_SkColorType,
                        kPremul_SkAlphaType);
  std::vector<uint8_t> bgra(info.computeMinByteSize());
  if (!bitmap.readPixels(info, bgra.data(), info.minRowBytes(), 0, 0)) {
    return image;
  }
  image.size = gfx::Size(bitmap.width(), bitmap.height());
  image.hotspot = hotspot;
  image.scale = scale > 0 ? scale : 1;
  image.bgra = std::move(bgra);
  return image;
}

DeskCursorImage UprightDeskCursorImage(DeskCursorImage turned,
                                       int quarter_turns) {
  CHECK(quarter_turns >= 0 && quarter_turns < 4) << quarter_turns;
  if (quarter_turns == 0 || turned.hidden()) {
    return turned;
  }
  const int turned_width = turned.size.width();
  const int turned_height = turned.size.height();
  const bool sideways = quarter_turns % 2 == 1;
  const int width = sideways ? turned_height : turned_width;
  const int height = sideways ? turned_width : turned_height;
  // Where upright pixel (x, y) is in `turned`, which the panel's turn moved
  // clockwise.
  const auto source = [&](int x, int y) {
    switch (quarter_turns) {
      case 1:
        return gfx::Point(height - 1 - y, x);
      case 2:
        return gfx::Point(width - 1 - x, height - 1 - y);
      default:
        return gfx::Point(y, width - 1 - x);
    }
  };
  std::vector<uint8_t> bgra(turned.bgra.size());
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const gfx::Point from = source(x, y);
      const size_t read_at =
          static_cast<size_t>(from.y() * turned_width + from.x()) * 4;
      const size_t write_at = static_cast<size_t>(y * width + x) * 4;
      std::copy_n(turned.bgra.begin() + read_at, 4, bgra.begin() + write_at);
    }
  }
  // The inverse of `wm::RotateCursorHotpoint`, which measures from the far
  // edge without the one pixel a pixel index would take off.
  const gfx::Point hotspot = turned.hotspot;
  switch (quarter_turns) {
    case 1:
      turned.hotspot = gfx::Point(hotspot.y(), turned_width - hotspot.x());
      break;
    case 2:
      turned.hotspot =
          gfx::Point(turned_width - hotspot.x(), turned_height - hotspot.y());
      break;
    default:
      turned.hotspot = gfx::Point(turned_height - hotspot.y(), hotspot.x());
      break;
  }
  turned.size = gfx::Size(width, height);
  turned.bgra = std::move(bgra);
  return turned;
}

// static
DeskCursorImageSource& DeskCursorImageSource::Get() {
  static base::NoDestructor<DeskCursorImageSource> source;
  return *source;
}

DeskCursorImageSource::DeskCursorImageSource() = default;
DeskCursorImageSource::~DeskCursorImageSource() = default;

std::optional<DeskCursorImage> DeskCursorImageSource::current() {
  base::AutoLock held(lock_);
  return image_;
}

DeskCursorImageSource::ListenerId DeskCursorImageSource::AddListener(
    Changed changed) {
  base::AutoLock held(lock_);
  const ListenerId id = next_id_++;
  listeners_.emplace_back(id, std::move(changed));
  return id;
}

void DeskCursorImageSource::RemoveListener(ListenerId listener) {
  base::AutoLock held(lock_);
  std::erase_if(listeners_, [listener](const auto& registered) {
    return registered.first == listener;
  });
}

void DeskCursorImageSource::Set(DeskCursorImage image) {
  // Run outside the lock, since a callback may re-enter this.
  std::vector<Changed> tell;
  {
    base::AutoLock held(lock_);
    if (image_ == image) {
      return;
    }
    image_ = image;
    for (const auto& listener : listeners_) {
      tell.push_back(listener.second);
    }
  }
  for (const Changed& changed : tell) {
    changed.Run(image);
  }
}

void DeskCursorImageSource::ResetForTesting() {
  base::AutoLock held(lock_);
  image_.reset();
}

}  // namespace ui
