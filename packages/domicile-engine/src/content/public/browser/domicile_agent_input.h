// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_PUBLIC_BROWSER_DOMICILE_AGENT_INPUT_H_
#define CONTENT_PUBLIC_BROWSER_DOMICILE_AGENT_INPUT_H_

#include <optional>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "content/common/content_export.h"
#include "third_party/blink/public/common/page/drag_operation.h"
#include "ui/gfx/geometry/point_f.h"

namespace content {

class RenderWidgetHost;
class WebContents;
struct DropData;

// What //chrome's agent seats (chrome/browser/domicile/domicile_agent_input.h)
// need of //content to hand an agent's pointer and keys to the page under a
// desk point, beside the user's and never moving them. See
// docs/architecture/AGENT-SEATS.md in the Domicile repository.

// The widget under `point` in `root`'s pages, `point` in `root`'s view's
// DIPs, and the point in that widget's view. Hit tests as a person's pointer
// is, so a page drawn over another is the one found. nullopt over nothing.
struct DomicileWidgetAt {
  raw_ptr<RenderWidgetHost> widget = nullptr;
  gfx::PointF in_widget;
};
CONTENT_EXPORT std::optional<DomicileWidgetAt> DomicileWidgetAtPoint(
    WebContents* root,
    const gfx::PointF& point);

// `point` in `root`'s view, in `widget`'s view, for a widget that keeps the
// pointer while a button is down. nullopt when `widget` is not one of
// `root`'s.
CONTENT_EXPORT std::optional<gfx::PointF> DomicilePointInWidget(
    WebContents* root,
    RenderWidgetHost* widget,
    const gfx::PointF& point);

// The page `widget` draws, which is a frame's in it for a frame of its own.
CONTENT_EXPORT WebContents* DomicilePageOfWidget(RenderWidgetHost* widget);

// Runs `forward`, which hands `widget` an event, without the press moving
// the desk's focused page to `widget`'s: an agent's press focuses within its
// page only.
CONTENT_EXPORT void DomicileForwardKeepingFocus(RenderWidgetHost* widget,
                                                base::OnceClosure forward);

// Where keys for `page` go: the widget of the frame focused in it.
CONTENT_EXPORT RenderWidgetHost* DomicileKeyWidgetOf(WebContents* page);

// Gives `page` page focus of its own, beside the user's, so it draws its
// caret and fires focus events for an agent's keys; or takes it away again,
// unless the user's focus is in it. Nothing else changes.
CONTENT_EXPORT void DomicileSetAgentPageFocus(WebContents* page, bool focused);

// The page the user's keyboard is in, within `outer`'s, or null.
CONTENT_EXPORT WebContents* DomicileUsersFocusedPage(WebContents* outer);

// Takes a drag a page starts, instead of the platform: an agent's drag, which
// //chrome carries over the pages under the agent's pointer. Given the drag's
// source widget, its data already filtered and the operations it allows;
// answers whether it took it. Process-wide, set once by //chrome, UI thread.
using DomicileDragTaker =
    base::RepeatingCallback<bool(RenderWidgetHost* source,
                                 const DropData& data,
                                 blink::DragOperationsMask allowed)>;
CONTENT_EXPORT void SetDomicileDragTaker(DomicileDragTaker taker);

}  // namespace content

#endif  // CONTENT_PUBLIC_BROWSER_DOMICILE_AGENT_INPUT_H_
