// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_
#define COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_

#include <optional>

#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// Where the cursor goes for a `warp_pointer` the page asked for.
//
// WHY A SHELL ASKS AT ALL. A desktop whose focus follows the cursor has to
// take the cursor with it when a key moves the focus, or the first pointer
// event after the press hands the focus back to whatever the pointer is still
// over. Every other compositor does this itself -- it is sway's
// `mouse_warping` -- and here the shell is a page, which can read where the
// pointer is and cannot put it anywhere. So the page says where, and the
// engine, which is what draws the cursor, is what moves it.
//
// `page` is the page's own box in the coordinates the cursor is moved in: its
// window's root, in DIP. `x` and `y` are the page's own, which is what a
// `PointerEvent` reports as `clientX`/`clientY` and what a shell lays its
// windows out in.
//
// TWO ANSWERS ARE REFUSALS RATHER THAN ARITHMETIC, and both are about what
// arrives here rather than about what a shell sends. A renderer can put any
// double on this channel, so a coordinate that is not a number has no nearest
// pixel and rounding one is undefined behavior; and a page whose window has no
// box has nowhere to put a cursor. Everything else is answered, CLAMPED INTO
// `page`: what a page may move is the pointer over itself, and a coordinate
// outside its own box is a page asking for another window's screen.
std::optional<gfx::Point> PointerWarpTarget(const gfx::Rect& page,
                                            double x,
                                            double y);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_POINTER_WARP_H_
