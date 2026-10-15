// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_presenters.h"

#include <algorithm>
#include <memory>
#include <utility>
#include <vector>

#include "base/logging.h"
#include "components/domicile/browser/desk_geometry.h"
#include "content/public/browser/domicile_desk.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/client/window_types.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/layer.h"
#include "ui/views/widget/widget.h"

namespace domicile {

struct DeskPresenters::Presenter {
  // A popup of the page's, mirrored on this presenter.
  struct PopupMirror {
    raw_ptr<aura::Window> popup;
    std::unique_ptr<ui::Layer> layer;
  };

  int64_t display = 0;
  gfx::Rect page;
  std::unique_ptr<views::Widget> widget;
  // Declared after the widget so they are destroyed first: their layers are in
  // the widget's tree.
  std::unique_ptr<content::DomicileDeskMirror> mirror;
  std::vector<PopupMirror> popups;
};

namespace {

// Whether `window`, a child of the host's root, is a popup of the page's.
// `RenderWidgetHostViewAura::InitAsPopup` makes a <select>'s list a menu.
// Patches 0051 and 0076 keep menus and tooltips in the root of the window they
// opened over.
bool IsPopup(const aura::Window* window) {
  return window->GetType() == aura::client::WINDOW_TYPE_MENU ||
         window->GetType() == aura::client::WINDOW_TYPE_TOOLTIP;
}

// A frameless window on `pixels` that takes no focus or input. The host
// window owns the page and receives all input.
std::unique_ptr<views::Widget> PresenterOn(const gfx::Rect& pixels) {
  auto widget = std::make_unique<views::Widget>();
  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW_FRAMELESS);
  params.name = "DomicileDeskPresenter";
  params.activatable = views::Widget::InitParams::Activatable::kNo;
  params.accept_events = false;
  params.bounds = pixels;
  widget->Init(std::move(params));
  // Set the bounds in pixels on the host: the CRTC's rect is in pixels and
  // `InitParams::bounds` are DIPs (see `FitTo` in domicile_shell_windows.cc).
  widget->GetNativeWindow()->GetHost()->SetBoundsInPixels(pixels);
  widget->Show();
  return widget;
}

}  // namespace

DeskPresenters::DeskPresenters() = default;

DeskPresenters::~DeskPresenters() = default;

void DeskPresenters::Present(content::WebContents* page,
                             const gfx::Rect& page_on_host,
                             const std::vector<Presented>& displays) {
  page_on_host_ = page_on_host;
  WatchRoot(page == nullptr ? nullptr : page->GetNativeView()->GetRootWindow());
  std::erase_if(
      presenters_, [&displays](const std::unique_ptr<Presenter>& one) {
        return std::ranges::find(displays, one->display, &Presented::display) ==
               displays.end();
      });
  for (const Presented& wanted : displays) {
    auto found = std::ranges::find(
        presenters_, wanted.display,
        [](const std::unique_ptr<Presenter>& one) { return one->display; });
    if (found == presenters_.end()) {
      VLOG(1) << "domicile: presenting the desk on display " << wanted.display
              << " at " << wanted.pixels.ToString();
      auto made = std::make_unique<Presenter>();
      made->display = wanted.display;
      made->widget = PresenterOn(wanted.pixels);
      presenters_.push_back(std::move(made));
      found = presenters_.end() - 1;
    }
    Presenter& presenter = **found;
    presenter.page = wanted.page;
    presenter.widget->GetNativeWindow()->GetHost()->SetBoundsInPixels(
        wanted.pixels);
    if (presenter.mirror == nullptr || !presenter.mirror->Mirrors(page)) {
      presenter.mirror.reset();
      presenter.mirror = content::MirrorDomicileDeskPage(page);
      if (presenter.mirror == nullptr) {
        // No view yet. Called again once the page loads.
        continue;
      }
      ui::Layer* root = presenter.widget->GetNativeWindow()->layer();
      root->Add(presenter.mirror->layer());
      // Below any popup mirrored before the page's new view was.
      root->StackAtBottom(presenter.mirror->layer());
    }
    presenter.mirror->layer()->SetBounds(wanted.page);
  }
  ShowPopups();
}

void DeskPresenters::OnWindowAdded(aura::Window* new_window) {
  if (IsPopup(new_window)) {
    AddPopup(new_window);
  }
}

void DeskPresenters::OnWillRemoveWindow(aura::Window* window) {
  RemovePopup(window);
}

void DeskPresenters::OnWindowBoundsChanged(aura::Window* window,
                                           const gfx::Rect& old_bounds,
                                           const gfx::Rect& new_bounds,
                                           ui::PropertyChangeReason reason) {
  ShowPopups();
}

void DeskPresenters::OnWindowDestroying(aura::Window* window) {
  if (root_.IsObservingSource(window)) {
    WatchRoot(nullptr);
    return;
  }
  RemovePopup(window);
}

void DeskPresenters::WatchRoot(aura::Window* root) {
  if (root_.GetSource() == root) {
    return;
  }
  for (aura::Window* popup :
       std::vector<aura::Window*>(popups_.begin(), popups_.end())) {
    RemovePopup(popup);
  }
  root_.Reset();
  if (root == nullptr) {
    return;
  }
  root_.Observe(root);
  for (aura::Window* child : root->children()) {
    if (IsPopup(child)) {
      AddPopup(child);
    }
  }
}

void DeskPresenters::AddPopup(aura::Window* window) {
  VLOG(1) << "domicile: presenting a popup at " << window->bounds().ToString();
  popups_.push_back(window);
  popup_observations_.AddObservation(window);
  ShowPopups();
}

void DeskPresenters::RemovePopup(aura::Window* window) {
  if (!popup_observations_.IsObservingSource(window)) {
    return;
  }
  popup_observations_.RemoveObservation(window);
  std::erase(popups_, window);
  ShowPopups();
}

void DeskPresenters::ShowPopups() {
  for (const std::unique_ptr<Presenter>& presenter : presenters_) {
    std::erase_if(
        presenter->popups, [this](const Presenter::PopupMirror& mirror) {
          return std::ranges::none_of(popups_, [&mirror](aura::Window* popup) {
            return popup == mirror.popup;
          });
        });
    for (aura::Window* popup : popups_) {
      auto found = std::ranges::find_if(
          presenter->popups, [popup](const Presenter::PopupMirror& mirror) {
            return mirror.popup == popup;
          });
      if (found == presenter->popups.end()) {
        presenter->popups.push_back(Presenter::PopupMirror{
            .popup = popup, .layer = popup->layer()->Mirror()});
        presenter->widget->GetNativeWindow()->layer()->Add(
            presenter->popups.back().layer.get());
        found = presenter->popups.end() - 1;
      }
      found->layer->SetBounds(PopupBoundsOn(popup->GetBoundsInRootWindow(),
                                            page_on_host_, presenter->page));
    }
  }
}

}  // namespace domicile
