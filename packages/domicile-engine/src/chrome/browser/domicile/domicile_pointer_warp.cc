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

// Draws the cursor on the display that a warp to `at` (in `root`'s DIPs)
// landed on. See `WarpLandsOn`.
void DrawForWhereItLanded(aura::Window* root, const gfx::Point& at) {
  const display::Screen* screen = display::Screen::Get();
  const std::vector<display::Display>& displays = screen->GetAllDisplays();
  // Skip displays the screen does not know yet; the layout can be ahead of it
  // during hotplug.
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
  // No desk: aura already picked the right display.
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
  // The frame closed before this ran, for example on reload or unplug.
  if (frame == nullptr) {
    return;
  }
  gfx::NativeView view = frame->GetNativeView();
  aura::Window* root = view == gfx::NativeView() ? nullptr : view->GetRootWindow();
  if (root == nullptr) {
    // The frame has no window, as in unit tests or during teardown.
    return;
  }

  // Convert from page coordinates to root window coordinates.
  const std::optional<gfx::Point> at =
      PointerWarpTarget(view->GetBoundsInRootWindow(), x, y);
  if (!at.has_value()) {
    // Blink rejects invalid coordinates first, so reaching here suggests an
    // unexpected renderer. See `PointerWarpTarget`.
    LOG(WARNING) << "domicile: a page asked for the pointer to be put at " << x
                 << "," << y << ", which is nowhere in its window";
    return;
  }
  root->GetHost()->MoveCursorToLocationInDIP(*at);
  // The move above draws the cursor on the host's display; redraw it on the
  // display the pointer reached.
  DrawForWhereItLanded(root, *at);
}

}  // namespace domicile
