// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_shell_windows.h"

#include <stddef.h>
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
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/gfx/geometry/rect_conversions.h"
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

// A window showing a shell, and the display its rectangle currently reads as.
//
// `nearest` is a SIGHTING AND NOT AN ANSWER. Mid-hotplug a window still at its
// old rectangle reads as being on the monitor that has just taken that corner
// of the desk -- see `ShellWindowPlaces`, which is what turns these into the
// display each window is actually on.
struct ShellWindow {
  int64_t nearest = display::kInvalidDisplayId;
  raw_ptr<BrowserWindowInterface> window = nullptr;
};

// What stands for a window in `ShellWindowPlaces`, which keeps identities
// rather than windows: the browser's own pointer, as a number, never
// dereferenced.
uintptr_t Identity(BrowserWindowInterface* window) {
  return reinterpret_cast<uintptr_t>(window);
}

// Every shell window the browser has, with the display each one's rectangle
// reads as.
//
// THE LIST IS READ FRESH EVERY TIME and what it reads is not. A window can
// close on its own -- a renderer that died, a shell that navigated away -- so
// which windows exist is the browser's to answer and shadowing it would leave
// entries for windows that are gone. Which DISPLAY each one is on is the
// opposite: its rectangle is the wrong answer for as long as a hotplug is in
// flight, so that is remembered per window and re-derived from this list.
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

// The sightings above, in the shape `ShellWindowPlaces` reads.
std::vector<SightedShellWindow> SightingsOf(
    const std::vector<ShellWindow>& held) {
  std::vector<SightedShellWindow> sighted;
  sighted.reserve(held.size());
  for (const ShellWindow& one : held) {
    sighted.push_back(SightedShellWindow{.window = Identity(one.window),
                                         .nearest = one.nearest});
  }
  return sighted;
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

  // A shell page has loaded in `window`: the display that window is on, by
  // the time this answers.
  //
  // THE DESK IS RECONCILED FIRST, and that is two things at once.
  //
  // It places the window startup opened, which is nobody's to open -- `--app=`
  // made it before this class existed -- so nothing has recorded it and the
  // page in it asks this as it loads. Placing it here pins it where its
  // rectangle is, once, which at that moment is right; from then on it is
  // remembered, so the reconciliation and the page's own name for its screen
  // are one answer.
  //
  // AND IT IS WHAT LIGHTS A COLD DESK. The first reconciliation runs at
  // `PostBrowserStart`, where the shell's own window has not committed its URL
  // yet -- so there is no window to copy, every other monitor is passed over
  // with a line saying so, and nothing asks again until a hotplug. A desk
  // booted with three monitors plugged in came up with one lit. A shell page
  // loading is exactly the thing that was missing, so it is what asks again.
  int64_t DisplayOfPageIn(BrowserWindowInterface* window) {
    Reconcile();
    return places_.Of(Identity(window));
  }

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
    const std::vector<ShellWindow> held = ShellWindowsNow();
    // Through the places rather than off the sighting, because the sighting is
    // exactly what a bounds change has just invalidated: the display moved,
    // and the window that belongs on it is still where it was.
    const std::vector<int64_t> windowed = places_.Update(SightingsOf(held));
    for (size_t index = 0; index < held.size(); ++index) {
      if (windowed[index] == display.id()) {
        // IN PIXELS, AND STRAIGHT TO THE HOST. A display's bounds are its
        // CRTC's on this platform, scale or no scale -- drm_screen.h says why
        // -- and `BaseWindow::SetBounds` takes DIPs, which it would multiply
        // by the scale into a rectangle no CRTC has.
        held[index]
            .window->GetWindow()
            ->GetNativeWindow()
            ->GetHost()
            ->SetBoundsInPixels(display.bounds());
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
    // THE DISPLAY EACH WINDOW IS ON, WHICH IS NOT THE DISPLAY ITS RECTANGLE
    // READS AS. A hotplug moves the desk's origins before the windows follow
    // them; reading the rectangles here is what used to open a second window
    // on one monitor and leave another dark. `ShellWindowPlaces` says why at
    // length.
    const std::vector<int64_t> placed = places_.Update(SightingsOf(held));
    std::vector<int64_t> windowed = placed;
    windowed.reserve(held.size() + opening_.size());
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
      Close(id, held, placed);
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
      // ORDINARY AT STARTUP and fatal nowhere: the first reconciliation runs
      // before the shell's own window has committed its URL. `ScreenOf` asks
      // again the moment a shell page loads, which is the soonest there is
      // anything to copy -- so a monitor named here is lit a beat later
      // rather than left dark.
      VLOG(1) << "domicile: display " << id
              << " wants a shell window and there is no shell to copy yet";
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
      LOG(ERROR) << "domicile: the shell window has no tab to copy, so "
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
    //
    // DIVIDED BY THE PRIMARY'S SCALE, which is not a display this window is
    // for. The bounds are DIPs to views and it has no window yet to take a
    // scale from, so it multiplies them by the primary display's -- and a
    // display's bounds here are already its CRTC's pixels. Divided first, the
    // window starts over the CRTC it is for, near enough that going
    // fullscreen finds that display and takes its exact rectangle.
    const float primary_scale =
        display::Screen::Get()->GetPrimaryDisplay().device_scale_factor();
    BrowserWindowCreateParams params = BrowserWindowCreateParams::CreateForApp(
        web_app::GenerateApplicationNameFromURL(url),
        /*trusted_source=*/true,
        gfx::ScaleToEnclosingRect(wanted->bounds(), 1.f / primary_scale),
        shell->GetProfile(),
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
      LOG(ERROR) << "domicile: no shell window for display " << id
                 << "; it stays dark until something asks again";
      return;
    }
    // BEFORE THE PAGE IS LOADED, because the page's own channel asks which
    // display it is on as it connects -- `ScreenOf` -- and this is the side
    // that knows. Recorded outright rather than left to the first sighting:
    // the window is placed on `id` by its bounds, and a hotplug between now
    // and the next reading would make that rectangle say something else.
    places_.Place(Identity(window), id);
    window->OpenGURL(url, WindowOpenDisposition::CURRENT_TAB);
  }

  void Close(int64_t id,
             const std::vector<ShellWindow>& held,
             const std::vector<int64_t>& placed) {
    for (size_t index = 0; index < held.size(); ++index) {
      if (placed[index] == id) {
        VLOG(1) << "domicile: closing the shell window on display " << id
                << ", which is no longer there";
        held[index].window->GetWindow()->Close();
        return;
      }
    }
  }

  // Displays whose window has been asked for and has not arrived yet.
  std::vector<int64_t> opening_;
  // Which display each window is on. Read by `ScreenOf` as well, through
  // `TheShellWindows` below: a page told one monitor and a window opened for
  // another is a monitor showing another monitor's desktop.
  ShellWindowPlaces places_;
};

// The one instance, or null until `StartShellWindows` has made it.
//
// `ScreenOf` reads the displays it keeps and must not be what brings it into
// being: constructing it reconciles the desk, and a page asking which monitor
// it is on is no reason to open windows.
ShellWindows*& TheShellWindows() {
  static ShellWindows* one = nullptr;
  return one;
}

// The shell window `frame` is the page of, or null for a frame that is in no
// window of this browser's -- a unit test, a guest, a view on its way out.
BrowserWindowInterface* WindowOf(content::RenderFrameHost* frame) {
  content::WebContents* contents =
      content::WebContents::FromRenderFrameHost(frame);
  if (contents == nullptr) {
    return nullptr;
  }
  BrowserWindowInterface* found = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [contents, &found](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab != nullptr && tab->GetContents() == contents) {
          found = browser;
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return found;
}

}  // namespace

std::string ScreenOf(content::RenderFrameHost* frame) {
  if (!ScansOut() || frame == nullptr || TheShellWindows() == nullptr) {
    return std::string();
  }
  BrowserWindowInterface* window = WindowOf(frame);
  if (window == nullptr) {
    return std::string();
  }
  // THE DISPLAY THIS WINDOW WAS OPENED FOR, not the one its rectangle reads
  // as. The two disagree for as long as a hotplug is in flight, and this is
  // read exactly then: a monitor plugged in is a window made, and the page in
  // it connects while the rest of the desk is still being laid out. Read off
  // the geometry, two pages claimed one monitor and a third monitor had a
  // page that named somebody else's.
  const int64_t on = TheShellWindows()->DisplayOfPageIn(window);
  if (on == display::kInvalidDisplayId) {
    return std::string();
  }
  return base::StrCat({"drm-", base::NumberToString(on)});
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
  TheShellWindows() = windows.get();
}

}  // namespace domicile
