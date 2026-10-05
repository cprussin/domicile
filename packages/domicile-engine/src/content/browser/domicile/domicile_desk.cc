// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_desk.h"

#include <utility>

#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "content/browser/renderer_host/render_widget_host_view_base.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/client/aura_constants.h"
#include "ui/aura/window.h"
#include "ui/base/class_property.h"
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

// Not a frame sink parent of the page. viz gives a sink the BeginFrameSource of
// its first parent, and after a detach reattaches from sources ordered by
// pointer, so a presenter as a second parent could leave the page ticking at a
// slower monitor. The mirrored surface layer references the page's surface,
// which is all viz needs to draw it here.
class Mirror : public DomicileDeskMirror {
 public:
  explicit Mirror(RenderWidgetHostViewBase* view)
      : view_(view->GetWeakPtr()),
        layer_(view->GetNativeView()->layer()->Mirror()) {}

  Mirror(const Mirror&) = delete;
  Mirror& operator=(const Mirror&) = delete;

  ui::Layer* layer() override { return layer_.get(); }

  bool Mirrors(WebContents* page) const override {
    return view_ && view_.get() == page->GetRenderWidgetHostView();
  }

 private:
  base::WeakPtr<RenderWidgetHostViewBase> view_;
  std::unique_ptr<ui::Layer> layer_;
};

}  // namespace

std::unique_ptr<DomicileDeskMirror> MirrorDomicileDeskPage(WebContents* page) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  auto* view =
      static_cast<RenderWidgetHostViewBase*>(page->GetRenderWidgetHostView());
  if (view == nullptr || view->GetNativeView() == nullptr) {
    return nullptr;
  }
  return std::make_unique<Mirror>(view);
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
      // Where the page is on the engine's screen, which is where every
      // widget in it is told it is: so a monitor's rect, from the page's
      // corner, is put on that screen too, and a <webview> finds its own
      // place among the monitors by its own rect.
      display::ScreenInfos placed = *infos;
      const gfx::Vector2d corner =
          window->GetBoundsInScreen().origin().OffsetFromOrigin();
      for (display::ScreenInfo& info : placed.screen_infos) {
        info.rect += corner;
        info.available_rect += corner;
      }
      return placed;
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
