// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_RENDER_PROCESS_H_
#define COMPONENTS_DOMICILE_BROWSER_RENDER_PROCESS_H_

#include <string_view>

#include "base/process/kill.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"

namespace domicile {

// Why a page's renderer went away, from WebContents::GetCrashedStatus.
// kRunning while it has one.
mojom::WebViewRenderProcess RenderProcessOf(base::TerminationStatus status);

// The reason's name, as `<webview>`'s `renderProcessGone` and the engine's
// line for a dead shell give it. Empty for kRunning.
std::string_view RenderProcessName(mojom::WebViewRenderProcess state);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_RENDER_PROCESS_H_
