// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/spike/window_diff.h"

#include <algorithm>
#include <utility>

#include "base/check.h"
#include "components/domicile/spike/spike_color.h"

namespace domicile::spike {

WindowCapture::WindowCapture() = default;

WindowCapture::WindowCapture(const gfx::Size& size,
                             std::vector<uint32_t> pixels)
    : size_(size), pixels_(std::move(pixels)) {}

WindowCapture::WindowCapture(const WindowCapture&) = default;

WindowCapture& WindowCapture::operator=(const WindowCapture&) = default;

WindowCapture::~WindowCapture() = default;

bool WindowCapture::valid() const {
  return !size_.IsEmpty() &&
         pixels_.size() ==
             static_cast<size_t>(size_.width()) * size_.height();
}

SkColor WindowCapture::At(int x, int y) const {
  return pixels_[static_cast<size_t>(y) * size_.width() + x];
}

bool WindowCapture::Contains(const gfx::Rect& rect) const {
  return gfx::Rect(size_).Contains(rect);
}

int WindowCapture::FindViewportTop(SkColor background, int tolerance) const {
  for (int y = 0; y < size_.height(); ++y) {
    bool all_background = true;
    for (int x = 0; x < size_.width(); ++x) {
      if (!ColorsMatch(At(x, y), background, tolerance)) {
        all_background = false;
        break;
      }
    }
    if (all_background) {
      return y;
    }
  }
  return -1;
}

RectDiff DiffRects(const WindowCapture& capture,
                   const gfx::Rect& a,
                   const gfx::Point& b_origin,
                   int tolerance,
                   int edge_radius) {
  CHECK(capture.Contains(a));
  CHECK(capture.Contains(gfx::Rect(b_origin, a.size())));

  RectDiff diff;
  const int w = a.width();
  const int h = a.height();
  std::vector<bool> mismatch(static_cast<size_t>(w) * h, false);

  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      const int delta = ChannelDistance(capture.At(a.x() + x, a.y() + y),
                                        capture.At(b_origin.x() + x,
                                                   b_origin.y() + y));
      diff.worst_delta = std::max(diff.worst_delta, delta);
      ++diff.compared;
      if (delta > tolerance) {
        ++diff.mismatched;
        mismatch[static_cast<size_t>(y) * w + x] = true;
      }
    }
  }

  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      if (!mismatch[static_cast<size_t>(y) * w + x]) {
        continue;
      }
      bool interior = true;
      for (int dy = -edge_radius; dy <= edge_radius && interior; ++dy) {
        for (int dx = -edge_radius; dx <= edge_radius; ++dx) {
          const int nx = x + dx;
          const int ny = y + dy;
          // A mismatch running off the edge of the compared rect is not
          // evidence of an interior, so out of bounds counts as mismatching.
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            continue;
          }
          if (!mismatch[static_cast<size_t>(ny) * w + nx]) {
            interior = false;
            break;
          }
        }
      }
      if (interior) {
        ++diff.interior_mismatched;
      }
    }
  }
  return diff;
}

}  // namespace domicile::spike
