// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_SPIKE_WINDOW_DIFF_H_
#define COMPONENTS_DOMICILE_SPIKE_WINDOW_DIFF_H_

#include <cstdint>
#include <vector>

#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile::spike {

// THROWAWAY, with the rest of the spike. The rule that turns a picture of the
// browser's window into step 4's verdicts, separated from the process that
// takes the picture so that the rule itself can be tested — every "pass" in
// ENGINE-FORK.md's measurement is this code's opinion.

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

  // Where the page starts inside the window: the first row that is
  // `background` all the way across, or -1 if there is none.
  //
  // The page is laid out with a margin of nothing but background above its
  // first cell, and no browser chrome is that colour across a whole row, so
  // this locates the viewport without the page having to report anything and
  // without the caller having to know how tall the window's own furniture is.
  int FindViewportTop(SkColor background, int tolerance) const;

 private:
  gfx::Size size_;
  std::vector<uint32_t> pixels_;
};

// What comparing two rects found.
struct RectDiff {
  int compared = 0;
  int mismatched = 0;
  // Mismatching pixels that are not on the boundary of a mismatching region.
  // This is the whole verdict: a composited surface resamples its edges where
  // an ordinary element rasterises them, exactly as a hardware-composited
  // <video> does, so a one-or-two-pixel outline is parity and a filled region
  // is not.
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
