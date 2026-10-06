// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_
#define COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_

#include <optional>

#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// The cursor position for a page's `warp_pointer` request.
//
// With focus-follows-mouse, the cursor must follow keyboard focus changes, as
// with sway's `mouse_warping`. A page cannot move the cursor, so the engine
// does it.
//
// `page` is the page's bounds in its window's root, in DIP. `x` and `y` are
// page coordinates, as in `PointerEvent.clientX`/`clientY`.
//
// Returns nothing for a non-finite coordinate or an empty `page`. Otherwise
// clamps into `page`, so a renderer cannot move the cursor onto another window.
std::optional<gfx::Point> PointerWarpTarget(const gfx::Rect& page,
                                            double x,
                                            double y);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_
