// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_pointer_warp.h"

#include <stdint.h>

#include <algorithm>
#include <optional>
#include <vector>

#include "base/check.h"
#include "base/logging.h"
#include "components/domicile/browser/desk_geometry.h"
#include "components/domicile/browser/pointer_warp.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/domicile_desk.h"
#include "content/public/browser/render_frame_host.h"
#include "ui/aura/client/cursor_client.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/display/display.h"
#include "ui/display/screen.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/native_ui_types.h"

namespace domicile {
namespace {

// Has the cursor drawn for the display a warp to `at`, in `root`'s DIPs,
// landed on. See `WarpLandsOn`.
void DrawForWhereItLanded(aura::Window* root, const gfx::Point& at) {
  const display::Screen* screen = display::Screen::Get();
  const std::vector<display::Display>& displays = screen->GetAllDisplays();
  // Only what the screen has, as the shell's windows read the desk: mid-hotplug
  // the layout can name a display the screen has not been told about.
  std::vector<DeskPlace> lit;
  for (const content::DomicileDeskDisplay& place : content::GetDomicileDesk()) {
    if (std::ranges::find(displays, place.id, &display::Display::id) !=
        displays.end()) {
      lit.push_back(
          DeskPlace{.id = place.id, .desk = place.desk, .scale = place.scale});
    }
  }
  const std::optional<int64_t> landed =
      WarpLandsOn(lit, screen->GetDisplayNearestWindow(root).id(), at);
  // No desk: the window is its own display's, and aura's choice is right.
  if (!landed.has_value()) {
    return;
  }
  const auto on = std::ranges::find(displays, *landed, &display::Display::id);
  CHECK(on != displays.end());
  aura::client::CursorClient* cursor = aura::client::GetCursorClient(root);
  CHECK(cursor);
  cursor->SetDisplay(*on);
}

}  // namespace

void WarpPointerIn(content::GlobalRenderFrameHostId frame_id,
                   double x,
                   double y) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(frame_id);
  // A page that has gone between asking and this running -- a reload, a
  // monitor unplugged and its window closed. Nothing to say: the cursor is
  // wherever it was, and there is no longer anybody who wanted it moved.
  if (frame == nullptr) {
    return;
  }
  gfx::NativeView view = frame->GetNativeView();
  aura::Window* root = view == gfx::NativeView() ? nullptr : view->GetRootWindow();
  if (root == nullptr) {
    // A frame that never made it to a window: a unit test, or a view
    // detached on its way out.
    return;
  }

  // THE PAGE'S OWN BOX, IN THE COORDINATES A CURSOR IS MOVED IN. A page's
  // coordinates start at the page and a root window's start at the window, and
  // between them is whatever the browser draws above the contents -- which for
  // a shell's window is nothing, and is not something this has to know.
  const std::optional<gfx::Point> at =
      PointerWarpTarget(view->GetBoundsInRootWindow(), x, y);
  if (!at.has_value()) {
    // Only a coordinate that is not a place, or a page with no box at all --
    // see `PointerWarpTarget`. Blink refuses the first before it reaches the
    // browser, so one arriving here is a renderer that is not the one we
    // built, and it is worth a line rather than a silent nothing.
    LOG(WARNING) << "domicile: a page asked for the pointer to be put at " << x
                 << "," << y << ", which is nowhere in its window";
    return;
  }
  root->GetHost()->MoveCursorToLocationInDIP(*at);
  // Which draws the arrow for the host's display, wherever on the desk the
  // pointer went.
  DrawForWhereItLanded(root, *at);
}

}  // namespace domicile
