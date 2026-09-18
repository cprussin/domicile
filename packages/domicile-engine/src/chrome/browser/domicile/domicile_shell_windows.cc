// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/domicile/domicile_shell_windows.h"

#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/web_applications/web_app_helpers.h"
#include "components/domicile/browser/shell_windows.h"
#include "components/domicile/common/domicile_scheme.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/base/window_open_disposition.h"
#include "ui/display/display.h"
#include "ui/display/display_observer.h"
#include "ui/display/screen.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/native_ui_types.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// Must match ui/ozone/public/ozone_switches.cc, and spelled out for the reason
// content/browser/domicile/domicile_frame_sink_broker.cc spells them out: a
// string is not worth a dependency on //ui/ozone.
constexpr char kScanoutPlatform[] = "drm";
constexpr char kOzonePlatformSwitch[] = "ozone-platform";

// Whether this engine is the one that scans out.
//
// ON THE PLATFORM THAT SCANS OUT AND NOWHERE ELSE, which is the same gate
// `DomicileDisplayWatcher` is behind and for the same reason, stated there: a
// nested run's screen is the HOST's monitors. Windowing those would open a
// browser window per monitor of the desk this developer run is sitting on, and
// naming one would tell the compositor its desktop is a display it has never
// heard of -- which it answers by narrowing to nothing, so the shell is told
// no screens at all and draws nothing.
bool ScansOut() {
  return base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
             kOzonePlatformSwitch) == kScanoutPlatform;
}

// A window showing a shell, and the display it is on.
struct ShellWindow {
  int64_t display = display::kInvalidDisplayId;
  raw_ptr<BrowserWindowInterface> window = nullptr;
};

// Every shell window the browser has, with the display each one is on.
//
// READ FRESH EVERY TIME RATHER THAN TRACKED. A map from display to window
// would have to be told about every window that closed on its own -- a
// renderer that died, a shell that navigated away -- and a stale entry is a
// display this believes is covered and leaves dark. The browser already keeps
// this list; asking it is cheaper than shadowing it correctly.
//
// In creation order, so the answer does not depend on which window was touched
// last -- the same reason `FindShellContents` next door asks for that order.
std::vector<ShellWindow> ShellWindowsNow() {
  std::vector<ShellWindow> found;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&found](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab == nullptr || !tab->GetContents()->GetLastCommittedURL().SchemeIs(
                                  kDomicileScheme)) {
          return true;
        }
        ui::BaseWindow* window = browser->GetWindow();
        if (window == nullptr) {
          return true;
        }
        found.push_back(
            ShellWindow{display::Screen::Get()
                            ->GetDisplayNearestWindow(window->GetNativeWindow())
                            .id(),
                        browser});
        return true;
      },
      BrowserCollection::Order::kCreation);
  return found;
}

// Keeps one shell window per display, through startup and every hotplug.
class ShellWindows : public display::DisplayObserver {
 public:
  ShellWindows() {
    display::Screen::Get()->AddObserver(this);
    Reconcile();
  }

  ShellWindows(const ShellWindows&) = delete;
  ShellWindows& operator=(const ShellWindows&) = delete;

  ~ShellWindows() override = default;

  // display::DisplayObserver:
  void OnDisplayAdded(const display::Display&) override { Reconcile(); }

  void OnDisplaysRemoved(const display::Displays&) override { Reconcile(); }

  // A DISPLAY THAT MOVED OR CHANGED MODE IS A WINDOW THAT HAS TO FOLLOW IT.
  // The window is bound to its controller on an exact rectangle match, so a
  // window still the old size is a window with no controller -- a black screen
  // with a clean log, which is the failure this whole area keeps producing.
  // Not an open or a close: the window is the right window and only its
  // rectangle is wrong.
  void OnDisplayMetricsChanged(const display::Display& display,
                               uint32_t changed_metrics) override {
    if ((changed_metrics & DISPLAY_METRIC_BOUNDS) == 0) {
      return;
    }
    for (const ShellWindow& one : ShellWindowsNow()) {
      if (one.display == display.id()) {
        one.window->GetWindow()->SetBounds(display.bounds());
      }
    }
  }

 private:
  void Reconcile() {
    CHECK_CURRENTLY_ON(content::BrowserThread::UI);
    if (!display::Screen::HasScreen()) {
      return;
    }
    const std::vector<ShellWindow> held = ShellWindowsNow();
    std::vector<int64_t> windowed;
    windowed.reserve(held.size() + opening_.size());
    for (const ShellWindow& one : held) {
      windowed.push_back(one.display);
    }
    // A WINDOW BEING MADE COUNTS AS A WINDOW. `CreateBrowserWindow` is
    // asynchronous here -- the synchronous form does not promise an
    // initialized window, and `OpenGURL` on one of those is documented to
    // crash -- so between asking for a window and getting it the display it is
    // for has none. A second hotplug in that gap would read the display as
    // bare and ask for a second window, and a monitor does not need two.
    for (int64_t coming : opening_) {
      windowed.push_back(coming);
    }
    // COPIED RATHER THAN HELD BY REFERENCE. `GetAllDisplays` hands back the
    // screen's own vector, and what follows opens and closes windows; a list
    // that reallocated underneath this loop would be read after it moved.
    const std::vector<display::Display> displays =
        display::Screen::Get()->GetAllDisplays();
    const ShellWindowPlan plan = ShellWindowsFor(displays, windowed);

    // OPEN BEFORE CLOSING, which `shell_windows.h` states and says why: a desk
    // whose monitors were all swapped at once closes as many windows as it
    // opens, and passing through zero windows is the browser exiting.
    for (int64_t id : plan.open) {
      Open(id, displays, held);
    }
    for (int64_t id : plan.close) {
      Close(id, held);
    }
  }

  // A copy of the shell window that already exists, on `id`.
  //
  // Copied rather than built from the command line, because what makes two
  // windows the same shell is that they are the same profile on the same URL,
  // and that pair is already sitting in the window startup opened. Nothing to
  // copy means startup has not run, and there is no shell to put anywhere.
  void Open(int64_t id,
            const std::vector<display::Display>& displays,
            const std::vector<ShellWindow>& held) {
    // EVERY WAY OUT OF HERE SAYS SO. A display that wanted a window and did
    // not get one is a monitor that stays dark, and the whole failure mode
    // this area keeps producing is a screen with nothing on it and nothing in
    // the log about why.
    if (held.empty()) {
      LOG(WARNING) << "domicile: display " << id
                   << " wants a shell window and there is no shell to copy";
      return;
    }
    const display::Display* wanted = nullptr;
    for (const display::Display& display : displays) {
      if (display.id() == id) {
        wanted = &display;
        break;
      }
    }
    if (wanted == nullptr) {
      // The display went away between being planned for and being opened,
      // which the next reconciliation will agree with.
      VLOG(1) << "domicile: display " << id << " went before its window came";
      return;
    }
    BrowserWindowInterface* shell = held.front().window;
    tabs::TabInterface* tab = shell->GetActiveTabInterface();
    if (tab == nullptr) {
      LOG(WARNING) << "domicile: the shell window has no tab to copy, so "
                      "display "
                   << id << " stays dark";
      return;
    }
    const GURL url = tab->GetContents()->GetLastCommittedURL();

    // THE BOUNDS ARE THE DISPLAY'S, NOT A GUESS. `display_id` on the create
    // params is `#if BUILDFLAG(IS_CHROMEOS)`, so there is no asking for a
    // display by name on this build -- a window lands on the display its
    // rectangle is on, which is what putting it at the display's own bounds
    // arranges. Fullscreen from the start rather than toggled afterwards,
    // because a window that is briefly somewhere else is a frame drawn on the
    // wrong monitor.
    BrowserWindowCreateParams params = BrowserWindowCreateParams::CreateForApp(
        web_app::GenerateApplicationNameFromURL(url),
        /*trusted_source=*/true, wanted->bounds(), shell->GetProfile(),
        /*user_gesture=*/false);
    params.initial_show_state = ui::mojom::WindowShowState::kFullscreen;
    // A desktop is not a session to restore. These windows are a function of
    // which monitors are plugged in, so writing them down would restore a desk
    // that is not the desk.
    params.omit_from_session_restore = true;
    params.should_trigger_session_restore = false;

    VLOG(1) << "domicile: opening a shell window on display " << id << " at "
            << wanted->bounds().ToString();
    opening_.push_back(id);
    // The asynchronous form, because the synchronous one does not promise an
    // initialized window and `OpenGURL` on an uninitialized one is documented
    // to crash.
    // `base::Unretained` because this is a NoDestructor that observes the
    // screen for the life of the browser: there is no teardown for the
    // callback to outlive.
    CreateBrowserWindow(
        std::move(params),
        base::BindOnce(&ShellWindows::Opened, base::Unretained(this), id, url));
  }

  // The window asked for on `id` arrived, or did not.
  void Opened(int64_t id, const GURL& url, BrowserWindowInterface* window) {
    std::erase(opening_, id);
    if (window == nullptr) {
      LOG(WARNING) << "domicile: no shell window for display " << id
                   << "; it stays dark until something asks again";
      return;
    }
    window->OpenGURL(url, WindowOpenDisposition::CURRENT_TAB);
  }

  void Close(int64_t id, const std::vector<ShellWindow>& held) {
    for (const ShellWindow& one : held) {
      if (one.display == id) {
        VLOG(1) << "domicile: closing the shell window on display " << id
                << ", which is no longer there";
        one.window->GetWindow()->Close();
        return;
      }
    }
  }

  // Displays whose window has been asked for and has not arrived yet.
  std::vector<int64_t> opening_;
};

}  // namespace

std::string ScreenOf(content::RenderFrameHost* frame) {
  if (!ScansOut() || frame == nullptr || !display::Screen::HasScreen()) {
    return std::string();
  }
  gfx::NativeView view = frame->GetNativeView();
  if (view == gfx::NativeView()) {
    return std::string();
  }
  const display::Display on = display::Screen::Get()->GetDisplayNearestView(view);
  if (on.id() == display::kInvalidDisplayId) {
    return std::string();
  }
  return base::StrCat({"drm-", base::NumberToString(on.id())});
}

void StartShellWindows() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!ScansOut()) {
    // A nested run is one window inside somebody else's session, and the
    // displays here are that session's. See `ScansOut`.
    return;
  }
  // Never torn down, like the command socket beside it: it observes the screen
  // for the life of the browser, and the browser outliving its own teardown
  // order is what a NoDestructor is for.
  static base::NoDestructor<ShellWindows> windows;
}

}  // namespace domicile
