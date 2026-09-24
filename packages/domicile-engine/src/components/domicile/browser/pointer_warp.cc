// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/pointer_warp.h"

#include <algorithm>
#include <cmath>
#include <optional>

#include "base/numerics/safe_conversions.h"

namespace domicile {
namespace {

// The nearest pixel to `at` that is still between `from` and `to`.
//
// `base::ClampRound` rather than a cast: a double large enough to be outside
// an int is a value a cast cannot carry and this one saturates, which the
// clamp below then pulls back to the window's own edge.
int Pinned(double at, int from, int to) {
  return std::clamp(base::ClampRound(at), from, to);
}

}  // namespace

std::optional<gfx::Point> PointerWarpTarget(const gfx::Rect& page,
                                            double x,
                                            double y) {
  if (page.IsEmpty() || !std::isfinite(x) || !std::isfinite(y)) {
    return std::nullopt;
  }
  // `right()` and `bottom()` are one past the window, so the last pixel of it
  // is one less -- and on a desk of two monitors the pixel they name is the
  // other screen's.
  return gfx::Point(Pinned(page.x() + x, page.x(), page.right() - 1),
                    Pinned(page.y() + y, page.y(), page.bottom() - 1));
}

}  // namespace domicile
