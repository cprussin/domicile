// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_

#include <optional>
#include <vector>

#include "content/public/browser/domicile_desk.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

namespace content {

// Records the compositor's layout: the displays it lights, or `std::nullopt`
// for an empty layout. Called from `SetDisplayLayout` in
// domicile_frame_sink_broker.cc.
void DomicileDeskLaidOut(std::optional<std::vector<DomicileDeskDisplay>> lit);

// The screen infos `SetDomicileDeskScreenInfos` set for the contents holding
// `view`, offset to the contents' window position on screen. Read by
// `RenderWidgetHostViewBase::GetNewScreenInfosForUpdate`.
std::optional<display::ScreenInfos> DomicileDeskScreenInfosFor(
    gfx::NativeView view);

// The screen infos for a frame inside a desk page, such as a <webview>'s
// page: `parent`'s, which a frame inherits, with the current screen narrowed
// to the monitor `bounds` (in screen coordinates) is on. Outside a desk,
// `parent` unchanged. Read by `RenderWidgetHostViewChildFrame::
// UpdateScreenInfo`. See `domicile::FrameScreenInfos`.
display::ScreenInfos DomicileFrameScreenInfos(display::ScreenInfos parent,
                                              const gfx::Rect& bounds);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_
