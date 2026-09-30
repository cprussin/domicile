// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_

#include <optional>
#include <vector>

#include "content/public/browser/domicile_desk.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/native_ui_types.h"

namespace content {

// The compositor stated a layout. From `SetDisplayLayout` in
// domicile_frame_sink_broker.cc.
void DomicileDeskLaidOut(std::vector<DomicileDeskDisplay> lit);

// What `SetDomicileDeskScreenInfos` told the contents `view` is in, if
// anything. Read by `RenderWidgetHostViewBase::GetNewScreenInfosForUpdate`.
std::optional<display::ScreenInfos> DomicileDeskScreenInfosFor(
    gfx::NativeView view);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_DESK_H_
