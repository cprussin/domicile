// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_presenters.h"

#include <algorithm>
#include <utility>

#include "base/logging.h"
#include "content/public/browser/domicile_desk.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/layer.h"
#include "ui/views/widget/widget.h"

namespace domicile {

struct DeskPresenters::Presenter {
  int64_t display = 0;
  std::unique_ptr<views::Widget> widget;
  // After the widget, so it goes first: it unregisters from the widget's
  // compositor.
  std::unique_ptr<content::DomicileDeskMirror> mirror;
};

namespace {

// A window on `pixels` that shows nothing of its own and takes no focus: the
// page it shows is the host's, and so is every key and click.
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
  // In pixels, straight to the host, for `FitTo`'s reason in
  // domicile_shell_windows.cc: the CRTC's rectangle is in pixels, and
  // `InitParams::bounds` are DIPs.
  widget->GetNativeWindow()->GetHost()->SetBoundsInPixels(pixels);
  widget->Show();
  return widget;
}

}  // namespace

DeskPresenters::DeskPresenters() = default;

DeskPresenters::~DeskPresenters() = default;

void DeskPresenters::Present(content::WebContents* page,
                             const std::vector<Presented>& displays) {
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
    presenter.widget->GetNativeWindow()->GetHost()->SetBoundsInPixels(
        wanted.pixels);
    if (presenter.mirror == nullptr || !presenter.mirror->Mirrors(page)) {
      presenter.mirror.reset();
      presenter.mirror = content::MirrorDomicileDeskPage(
          page, presenter.widget->GetCompositor());
      if (presenter.mirror == nullptr) {
        // No view yet. The page loading asks again.
        continue;
      }
      presenter.widget->GetNativeWindow()->layer()->Add(
          presenter.mirror->layer());
    }
    presenter.mirror->layer()->SetBounds(wanted.page);
  }
}

}  // namespace domicile
