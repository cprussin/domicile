// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/captured_color.h"

#include <sys/mman.h>

#include <cstddef>
#include <cstdint>

#include "base/compiler_specific.h"
#include "base/containers/span.h"

namespace domicile {
namespace {

// DRM_FORMAT_ARGB8888 and DRM_FORMAT_ABGR8888.
constexpr uint32_t kArgb8888 = 0x34325241;
constexpr uint32_t kAbgr8888 = 0x34324241;

// DRM_FORMAT_MOD_LINEAR.
constexpr uint64_t kLinear = 0;

}  // namespace

int64_t CenterColor(const DomicileCapturedFrame& record) {
  if (record.plane_count != 1 ||
      (record.memory == DOMICILE_CAPTURE_DMABUF && record.modifier != kLinear) ||
      (record.fourcc != kArgb8888 && record.fourcc != kAbgr8888)) {
    return -1;
  }
  const DomicileDmabufPlane plane = base::span(record.planes)[0];
  const size_t length =
      plane.offset + static_cast<size_t>(plane.stride) * record.height;
  void* mapped = mmap(nullptr, length, PROT_READ, MAP_SHARED, plane.fd, 0);
  if (mapped == MAP_FAILED) {
    return -1;
  }
  // SAFETY: `mapped` is `length` bytes, mapped just above.
  const auto bytes = UNSAFE_BUFFERS(
      base::span(static_cast<const uint8_t*>(mapped), length));
  const size_t x = static_cast<size_t>(record.content_x) +
                   static_cast<size_t>(record.content_width) / 2;
  const size_t y = static_cast<size_t>(record.content_y) +
                   static_cast<size_t>(record.content_height) / 2;
  const auto pixel = bytes.subspan(plane.offset + y * plane.stride + x * 4, 4u);
  // ARGB8888 is B, G, R, A in memory; ABGR8888 is R, G, B, A.
  const bool bgra = record.fourcc == kArgb8888;
  const uint32_t red = bgra ? pixel[2] : pixel[0];
  const uint32_t green = pixel[1];
  const uint32_t blue = bgra ? pixel[0] : pixel[2];
  munmap(mapped, length);
  return (red << 16) | (green << 8) | blue;
}

}  // namespace domicile
