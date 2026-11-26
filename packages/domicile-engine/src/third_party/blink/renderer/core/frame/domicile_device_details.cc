// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/frame/domicile_device_details.h"

#include <utility>

#include "base/compiler_specific.h"
#include "components/domicile/common/device_details.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/canvas/image_data.h"
#include "third_party/blink/renderer/platform/graphics/static_bitmap_image.h"
#include "third_party/blink/renderer/platform/graphics/unaccelerated_static_bitmap_image.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkImage.h"
#include "third_party/skia/include/core/SkPixmap.h"

namespace blink {

namespace {

// `pixmap`'s bytes, when it has 4 a pixel and no gaps between rows: what
// domicile::FarblePixels takes.
std::optional<base::span<uint8_t>> PixelsOf(const SkPixmap& pixmap) {
  if (pixmap.addr() == nullptr || pixmap.info().bytesPerPixel() != 4 ||
      pixmap.rowBytes() != pixmap.info().minRowBytes()) {
    return std::nullopt;
  }
  // SAFETY: an SkPixmap's pixels are computeByteSize() bytes from addr().
  return UNSAFE_BUFFERS(base::span<uint8_t>(
      static_cast<uint8_t*>(pixmap.writable_addr()), pixmap.computeByteSize()));
}

}  // namespace

std::optional<uint64_t> DomicileDeviceDetailsSeed(
    const ExecutionContext* context) {
  const LocalDOMWindow* window = DynamicTo<LocalDOMWindow>(context);
  while (window != nullptr) {
    if (const std::optional<uint64_t> seed =
            window->DomicileDeviceDetailsSeed()) {
      return seed;
    }
    const LocalFrame* frame = window->GetFrame();
    if (frame == nullptr) {
      return std::nullopt;
    }
    const auto* parent = DynamicTo<LocalFrame>(frame->Parent());
    window = parent != nullptr ? parent->DomWindow() : nullptr;
  }
  return std::nullopt;
}

unsigned DomicileHardwareConcurrency(const ExecutionContext* context,
                                     unsigned real) {
  const std::optional<uint64_t> seed = DomicileDeviceDetailsSeed(context);
  return seed ? domicile::FarbledHardwareConcurrency(*seed, real) : real;
}

void DomicileFarbleAudio(const ExecutionContext* context,
                         base::span<float> samples) {
  const std::optional<uint64_t> seed = DomicileDeviceDetailsSeed(context);
  if (!seed) {
    return;
  }
  const float factor = domicile::FarbledAudioFactor(*seed);
  for (float& sample : samples) {
    sample *= factor;
  }
}

void DomicileFarbleImageData(const ExecutionContext* context,
                             ImageData& image_data) {
  const std::optional<uint64_t> seed = DomicileDeviceDetailsSeed(context);
  if (!seed) {
    return;
  }
  // Only 8 bits a channel: a float16 or float32 ImageData keeps the truth.
  if (const std::optional<base::span<uint8_t>> pixels =
          PixelsOf(image_data.GetSkPixmap())) {
    domicile::FarblePixels(*seed, *pixels);
  }
}

scoped_refptr<StaticBitmapImage> DomicileFarbledImage(
    const ExecutionContext* context,
    scoped_refptr<StaticBitmapImage> image) {
  const std::optional<uint64_t> seed = DomicileDeviceDetailsSeed(context);
  if (!seed || !image) {
    return image;
  }
  const PaintImage paint = image->PaintImageForCurrentFrame();
  // Unpremultiplied, so a changed color stays a valid one.
  const SkImageInfo info = SkImageInfo::Make(
      image->width(), image->height(), kN32_SkColorType, kUnpremul_SkAlphaType,
      paint.GetSkImageInfo().refColorSpace());
  SkBitmap bitmap;
  if (!bitmap.tryAllocPixels(info) || !paint.readPixels(bitmap.pixmap(), 0, 0)) {
    // A picture that can't be read back can't be exported either; the export
    // says so as it would have.
    return image;
  }
  if (const std::optional<base::span<uint8_t>> pixels =
          PixelsOf(bitmap.pixmap())) {
    domicile::FarblePixels(*seed, *pixels);
  }
  bitmap.setImmutable();
  return UnacceleratedStaticBitmapImage::Create(
      SkImages::RasterFromBitmap(bitmap), image->Orientation());
}

}  // namespace blink
