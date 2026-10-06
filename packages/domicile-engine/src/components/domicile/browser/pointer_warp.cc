// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/pointer_warp.h"

#include <algorithm>
#include <cmath>
#include <optional>

#include "base/numerics/safe_conversions.h"

namespace domicile {
namespace {

// The nearest pixel to `at` within [`from`, `to`].
//
// `base::ClampRound` saturates values outside the int range, where a cast
// would be undefined.
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
  // `right()` and `bottom()` are one past the edge, which may be on another
  // monitor.
  return gfx::Point(Pinned(page.x() + x, page.x(), page.right() - 1),
                    Pinned(page.y() + y, page.y(), page.bottom() - 1));
}

}  // namespace domicile
