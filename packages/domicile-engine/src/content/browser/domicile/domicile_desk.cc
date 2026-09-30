// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_desk.h"

#include <utility>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "content/browser/renderer_host/render_widget_host_view_base.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/client/aura_constants.h"
#include "ui/aura/window.h"
#include "ui/base/class_property.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"

DEFINE_UI_CLASS_PROPERTY_TYPE(display::ScreenInfos*)

namespace content {
namespace {

// On the contents' own window, and read from any window under it: every
// RenderWidgetHostView the contents makes -- one per renderer the page goes
// through -- puts its own window there. Walked by hand, because aura::Window
// does not cascade properties to its children.
DEFINE_OWNED_UI_CLASS_PROPERTY_KEY(display::ScreenInfos,
                                   kDomicileDeskScreenInfosKey)

// gfx::Rect* is aura's property type (aura_constants.h), not defined again.
DEFINE_OWNED_UI_CLASS_PROPERTY_KEY(gfx::Rect, kDomicileDeskPageBoundsKey)

struct Desk {
  std::vector<DomicileDeskDisplay> lit;
  base::RepeatingClosureList observers;
};

Desk& TheDesk() {
  static base::NoDestructor<Desk> desk;
  return *desk;
}

class Mirror : public DomicileDeskMirror {
 public:
  Mirror(RenderWidgetHostViewBase* view, ui::Compositor* into)
      : view_(view->GetWeakPtr()),
        sink_(view->GetFrameSinkId()),
        into_(into),
        layer_(view->GetNativeView()->layer()->Mirror()) {
    into_->AddChildFrameSink(sink_);
  }

  Mirror(const Mirror&) = delete;
  Mirror& operator=(const Mirror&) = delete;

  ~Mirror() override { into_->RemoveChildFrameSink(sink_); }

  ui::Layer* layer() override { return layer_.get(); }

  bool Mirrors(WebContents* page) const override {
    return view_ && view_.get() == page->GetRenderWidgetHostView();
  }

 private:
  base::WeakPtr<RenderWidgetHostViewBase> view_;
  const viz::FrameSinkId sink_;
  // Outlives this: the window whose layers this is in owns it.
  const raw_ptr<ui::Compositor> into_;
  std::unique_ptr<ui::Layer> layer_;
};

}  // namespace

std::unique_ptr<DomicileDeskMirror> MirrorDomicileDeskPage(
    WebContents* page,
    ui::Compositor* into) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  auto* view =
      static_cast<RenderWidgetHostViewBase*>(page->GetRenderWidgetHostView());
  if (view == nullptr || view->GetNativeView() == nullptr) {
    return nullptr;
  }
  return std::make_unique<Mirror>(view, into);
}

std::vector<DomicileDeskDisplay> GetDomicileDesk() {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  return TheDesk().lit;
}

base::CallbackListSubscription AddDomicileDeskObserver(
    base::RepeatingClosure changed) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  return TheDesk().observers.Add(std::move(changed));
}

void DomicileDeskLaidOut(std::vector<DomicileDeskDisplay> lit) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  if (TheDesk().lit == lit) {
    return;
  }
  TheDesk().lit = std::move(lit);
  TheDesk().observers.Notify();
}

void SetDomicileDeskScreenInfos(WebContents* contents,
                                std::optional<display::ScreenInfos> infos) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  aura::Window* window = contents->GetNativeView();
  if (infos.has_value()) {
    window->SetProperty(kDomicileDeskScreenInfosKey, std::move(*infos));
  } else {
    window->ClearProperty(kDomicileDeskScreenInfosKey);
  }
  auto* view = static_cast<RenderWidgetHostViewBase*>(
      contents->GetRenderWidgetHostView());
  if (view != nullptr) {
    view->UpdateScreenInfo();
  }
}

std::optional<display::ScreenInfos> DomicileDeskScreenInfosFor(
    gfx::NativeView view) {
  for (aura::Window* window = view; window != nullptr;
       window = window->parent()) {
    const display::ScreenInfos* infos =
        window->GetProperty(kDomicileDeskScreenInfosKey);
    if (infos != nullptr) {
      return *infos;
    }
  }
  return std::nullopt;
}

void SetDomicileDeskPageBounds(gfx::NativeWindow window,
                               std::optional<gfx::Rect> bounds) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  if (bounds.has_value()) {
    window->SetProperty(kDomicileDeskPageBoundsKey, *bounds);
  } else {
    window->ClearProperty(kDomicileDeskPageBoundsKey);
  }
}

std::optional<gfx::Rect> GetDomicileDeskPageBounds(gfx::NativeWindow window) {
  if (window == nullptr) {
    return std::nullopt;
  }
  const gfx::Rect* bounds = window->GetProperty(kDomicileDeskPageBoundsKey);
  if (bounds == nullptr) {
    return std::nullopt;
  }
  return *bounds;
}

}  // namespace content
