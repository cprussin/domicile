// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_

#include <optional>

#include "ui/gfx/geometry/point_f.h"

namespace ui {
class LocatedEvent;
}  // namespace ui

namespace domicile {

// Where `event` is in the shell page's CSS pixels. `std::nullopt` while
// there is no shell to be over, or for an event on another root window than
// the shell's.
std::optional<gfx::PointF> ShellPointOf(const ui::LocatedEvent& event);

// Reports every pointer move the browser process dispatches to
// `DeskPointer`, in the shell page's CSS pixels, for the compositor's screen
// casts. A pointer over the shell's page or a browser window reaches the
// compositor no other way.
//
// Must be called once, on the UI thread, once aura::Env exists
// (ChromeBrowserMainParts::PostBrowserStart).
void StartDeskPointer();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_
