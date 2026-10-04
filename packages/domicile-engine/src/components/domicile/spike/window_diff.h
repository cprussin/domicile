// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_SPIKE_WINDOW_DIFF_H_
#define COMPONENTS_DOMICILE_SPIKE_WINDOW_DIFF_H_

#include <cstdint>
#include <vector>

#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile::spike {

// Spike only: the pixel comparison behind the CSS parity verdicts in
// docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity. Kept apart from the
// capture so it can be unit tested.

// The browser's window as viz drew it: row-major SkColor (ARGB).
class WindowCapture {
 public:
  WindowCapture();
  WindowCapture(const gfx::Size& size, std::vector<uint32_t> pixels);
  WindowCapture(const WindowCapture&);
  WindowCapture& operator=(const WindowCapture&);
  ~WindowCapture();

  // False if `pixels` does not describe a `size` bitmap.
  bool valid() const;
  const gfx::Size& size() const { return size_; }

  SkColor At(int x, int y) const;
  bool Contains(const gfx::Rect& rect) const;

  // The first row that is `background` all the way across, or -1 if none.
  //
  // Finds the top of the page: the page has a background margin above its
  // first cell, and no browser chrome row is entirely that color.
  int FindViewportTop(SkColor background, int tolerance) const;

 private:
  gfx::Size size_;
  std::vector<uint32_t> pixels_;
};

// What comparing two rects found.
struct RectDiff {
  int compared = 0;
  int mismatched = 0;
  // Mismatching pixels not on the boundary of a mismatching region. A
  // composited surface resamples its edges, so an outline of mismatches is
  // still parity and only interior mismatches fail.
  int interior_mismatched = 0;
  int worst_delta = 0;
};

// Compares the rect `a` with the same-sized rect at `b_origin`.
//
// A pixel counts as differing when some channel is more than `tolerance` away
// from its counterpart, and as interior when every pixel within `edge_radius`
// of it differs too. Both rects must be inside `capture`.
RectDiff DiffRects(const WindowCapture& capture,
                   const gfx::Rect& a,
                   const gfx::Point& b_origin,
                   int tolerance,
                   int edge_radius);

}  // namespace domicile::spike

#endif  // COMPONENTS_DOMICILE_SPIKE_WINDOW_DIFF_H_
