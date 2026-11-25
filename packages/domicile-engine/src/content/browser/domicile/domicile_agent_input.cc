// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_agent_input.h"

#include <utility>

#include "base/logging.h"
#include "base/no_destructor.h"
#include "components/input/render_widget_host_input_event_router.h"
#include "content/browser/renderer_host/frame_tree_node.h"
#include "content/browser/renderer_host/render_frame_host_impl.h"
#include "content/browser/renderer_host/render_widget_host_impl.h"
#include "content/browser/renderer_host/render_widget_host_view_base.h"
#include "content/browser/web_contents/web_contents_impl.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/domicile_agent_input.h"
#include "content/public/common/drop_data.h"

namespace content {

namespace {

DomicileDragTaker& DragTaker() {
  static base::NoDestructor<DomicileDragTaker> taker;
  return *taker;
}

RenderWidgetHostViewBase* ViewOf(WebContents* page) {
  return page ? static_cast<RenderWidgetHostViewBase*>(
                    page->GetRenderWidgetHostView())
              : nullptr;
}

}  // namespace

std::optional<DomicileWidgetAt> DomicileWidgetAtPoint(
    WebContents* root,
    const gfx::PointF& point) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  RenderWidgetHostViewBase* view = ViewOf(root);
  if (!view) {
    return std::nullopt;
  }
  input::RenderWidgetHostInputEventRouter* router =
      static_cast<WebContentsImpl*>(root)->GetInputEventRouter();
  if (!router) {
    return std::nullopt;
  }
  gfx::PointF in_widget;
  input::RenderWidgetHostViewInput* found =
      router->GetRenderWidgetHostViewInputAtPoint(view, point, &in_widget);
  if (!found) {
    return std::nullopt;
  }
  return DomicileWidgetAt{
      .widget = static_cast<RenderWidgetHostViewBase*>(found)->host(),
      .in_widget = in_widget};
}

std::optional<gfx::PointF> DomicilePointInWidget(WebContents* root,
                                                 RenderWidgetHost* widget,
                                                 const gfx::PointF& point) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  RenderWidgetHostViewBase* view = ViewOf(root);
  RenderWidgetHostViewBase* target =
      widget ? static_cast<RenderWidgetHostViewBase*>(widget->GetView())
             : nullptr;
  if (!view || !target) {
    return std::nullopt;
  }
  if (view == target) {
    return point;
  }
  gfx::PointF in_widget;
  if (!view->TransformPointToCoordSpaceForView(point, target, &in_widget)) {
    return std::nullopt;
  }
  return in_widget;
}

WebContents* DomicilePageOfWidget(RenderWidgetHost* widget) {
  return widget ? WebContentsImpl::FromRenderWidgetHostImpl(
                      RenderWidgetHostImpl::From(widget))
                : nullptr;
}

void DomicileForwardKeepingFocus(RenderWidgetHost* widget,
                                 base::OnceClosure forward) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  RenderWidgetHostImpl* host = RenderWidgetHostImpl::From(widget);
  // The widget dispatches the event as it is forwarded, so the flag covers
  // this event alone. Forwarding can take the widget down with its page.
  base::WeakPtr<RenderWidgetHostImpl> keeping = host->GetWeakPtr();
  host->set_dispatch_keeps_focus(true);
  std::move(forward).Run();
  if (keeping) {
    keeping->set_dispatch_keeps_focus(false);
  }
}

RenderWidgetHost* DomicileKeyWidgetOf(WebContents* page) {
  WebContentsImpl* contents = static_cast<WebContentsImpl*>(page);
  FrameTreeNode* focused = contents->GetPrimaryFrameTree().GetFocusedFrame();
  RenderFrameHostImpl* frame = focused ? focused->current_frame_host()
                                       : contents->GetPrimaryMainFrame();
  return frame->GetRenderWidgetHost();
}

void DomicileSetAgentPageFocus(WebContents* page, bool focused) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  WebContentsImpl* contents = static_cast<WebContentsImpl*>(page);
  RenderWidgetHostImpl* widget =
      contents->GetPrimaryMainFrame()->GetRenderWidgetHost();
  if (widget->is_focused() == focused) {
    return;
  }
  if (!focused &&
      contents->GetOutermostWebContents()->GetFocusedWebContents() ==
          contents) {
    // The user's: it keeps the focus they gave it.
    return;
  }
  VLOG(1) << "domicile: an agent's keyboard "
          << (focused ? "focuses " : "leaves ")
          << contents->GetLastCommittedURL().GetWithEmptyPath()
          << "; the user's focus stays where it is";
  widget->SetPageFocus(focused);
}

WebContents* DomicileUsersFocusedPage(WebContents* outer) {
  return outer ? static_cast<WebContentsImpl*>(outer)->GetFocusedWebContents()
               : nullptr;
}

void SetDomicileDragTaker(DomicileDragTaker taker) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  CHECK(DragTaker().is_null() || taker.is_null());
  DragTaker() = std::move(taker);
}

bool DomicileTakesDrag(RenderWidgetHostImpl* source,
                       const DropData& data,
                       blink::DragOperationsMask allowed) {
  return !DragTaker().is_null() && DragTaker().Run(source, data, allowed);
}

}  // namespace content
