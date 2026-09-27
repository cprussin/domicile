// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_CROSSING_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_CROSSING_H_

#include <optional>
#include <vector>

#include "ui/display/display.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {

// One window a pointer can be on, as `DrmCursor` tracks it.
struct PointerScreen {
  gfx::AcceleratedWidget window = gfx::kNullAcceleratedWidget;
  // The CRTC's rectangle on the engine's desktop, in pixels.
  gfx::Rect bounds_in_screen;
  // Which way the monitor is turned; what `CursorController` turns a hand's
  // motion by on this window.
  display::Display::Rotation rotation = display::Display::ROTATE_0;
};

// Where a pointer that left its screen arrives.
struct PointerCrossing {
  gfx::AcceleratedWidget window = gfx::kNullAcceleratedWidget;
  // In that window's panel pixels, unclamped.
  gfx::PointF location;
};

// Which screen a pointer moved to `location` crosses onto, if any.
//
// WHY THE ENGINE AND NOT THE SHELL. A desk of several monitors is a browser
// window per CRTC (see `ShellWindowsFor`), and upstream `DrmCursor` holds the
// pointer inside whichever window it is on: ash is what moves it to the next
// display (`ExtendedMouseWarpController`), and a views browser has no ash. So
// the pointer is carried across here, below every page, and a shell never
// learns there is more than one monitor under it.
//
// `from` is the window the pointer is on, and `location` is where the hand's
// motion took it in that window's panel pixels, before it is clamped in.
//
// ACROSS THE DESKTOP A PROFILE PLACES, NOT THE ENGINE'S. The compositor steps
// the CRTCs across one row whatever the profile says, so the row knows
// nothing about a laptop at the bottom-left or centered under a monitor.
// `layout` is what does: each lit connector's rectangle on the desktop a
// shell lays out in. The pointer leaves by any edge, onto whichever screen is
// placed there, at the place it is placed there -- sway's rule. A connector
// the layout leaves dark has no place and is never entered, and a layout that
// says nothing (the hardware decides) is the engine's own desktop.
//
// BY THE UPRIGHT EDGE, NOT THE PANEL'S. A monitor stood on its side still has
// a landscape CRTC, and a hand moving right on it moves along the panel's y.
// So a pointer is read the way the person sees the screen, and turned back
// onto the panel it lands on.
std::optional<PointerCrossing> PointerCrossingFor(
    const std::vector<PointerScreen>& screens,
    const std::vector<DomicileDisplayLayout>& layout,
    gfx::AcceleratedWidget from,
    const gfx::PointF& location);

// Whether a window at `bounds_in_screen` takes a key, with the pointer at
// `pointer` on the engine's desktop.
//
// THE KEYBOARD IS ON THE MONITOR THE POINTER IS ON. Upstream a key is offered
// to every `DrmWindowHost` and each says yes -- "For non-ash builds we would
// need smarter keyboard focus" -- so the window added first took every key,
// and a page on any other monitor could draw a focused box it would never
// hear a key in. Nothing below a page knows which monitor a shell means the
// keyboard to be on, and the pointer is the one thing both agree about: it is
// what a click is routed by, and what a shell warps when a key moves the
// focus.
bool HasTheKeyboard(const gfx::Rect& bounds_in_screen,
                    const gfx::PointF& pointer);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_CROSSING_H_
