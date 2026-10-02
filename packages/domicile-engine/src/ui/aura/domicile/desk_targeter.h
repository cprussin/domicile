// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_AURA_DOMICILE_DESK_TARGETER_H_
#define UI_AURA_DOMICILE_DESK_TARGETER_H_

#include <optional>

#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace aura {

class Window;

// Where in the page a pointer at `at` in the root window is, when the page
// should have it and aura would not give it: `at` past the root window's
// `root` size, inside `page_in_root`. `std::nullopt` everywhere else, which
// is aura's to target as it always does.
std::optional<gfx::PointF> DeskPagePoint(const gfx::Size& root,
                                         const gfx::Rect& page_in_root,
                                         const gfx::PointF& at);

// Gives `page` every pointer that reaches `root` from past its edge, or stops
// when `page` is null.
//
// A POINTER ON ANOTHER MONITOR IS STILL THE PAGE'S. On a tty the desk is one
// page in the window on the host monitor, laid out over every monitor and
// offset so the host shows its part (see content/public/browser/
// domicile_desk.h). Ozone hands that window every pointer event, on whichever
// monitor, at its place on the page -- so a pointer on the next monitor is at
// a place past the window's edge. aura's targeter explores a window only where
// its bounds reach, and the window between the root and the page is the
// root's size: it found nothing there and gave the event to the root, which
// does nothing with it. No hover, no click, on every monitor but the host's.
//
// So the root's targeter looks into `page` for anything it would have kept
// for itself past its edge. What aura targets first is untouched: a pressed
// button's window and a capture still take every move, which is what lets a
// drag leave the host monitor and come back.
void TargetDeskPage(Window* root, Window* page);

}  // namespace aura

#endif  // UI_AURA_DOMICILE_DESK_TARGETER_H_
