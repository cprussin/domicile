// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/desk_cursor_image.h"

#include <utility>
#include <vector>

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
