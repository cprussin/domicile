// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_pointer.h"

#include <optional>
#include <vector>

#include "base/no_destructor.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "components/domicile/browser/desk_pointer.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

namespace domicile {
namespace {

// Where `event` is in the shell page's CSS pixels: the inverse of
// `PointerWarpTarget`. `std::nullopt` while there is no shell to be over, or
// for a move on another root window than the shell's.
std::optional<gfx::PointF> OnTheShell(const ui::LocatedEvent& event) {
  content::WebContents* shell = DeskShellContents();
  if (shell == nullptr) {
    return std::nullopt;
  }
  gfx::NativeView view = shell->GetNativeView();
  aura::Window* target = static_cast<aura::Window*>(event.target());
  if (view == gfx::NativeView() || target == nullptr ||
      view->GetRootWindow() != target->GetRootWindow()) {
    return std::nullopt;
  }
  const gfx::Rect page = view->GetBoundsInRootWindow();
  return event.root_location_f() - page.OffsetFromOrigin();
}

class DeskPointerReporter : public ui::EventObserver {
 public:
  DeskPointerReporter() {
    aura::Env* env = aura::Env::GetInstance();
    env->AddEventObserver(
        this, env, {ui::EventType::kMouseMoved, ui::EventType::kMouseDragged});
  }

  // ui::EventObserver:
  void OnEvent(const ui::Event& event) override {
    const std::optional<gfx::PointF> at = OnTheShell(*event.AsLocatedEvent());
    DeskPointer::Get().MovedTo(DeskPointerAt{
        at, at ? BrowserWindowsAt(*at) : std::vector<PointerOverWindow>()});
  }
};

}  // namespace

void StartDeskPointer() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<DeskPointerReporter> reporter;
}

}  // namespace domicile
