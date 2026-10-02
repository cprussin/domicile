// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_shell_windows.h"

#include <stddef.h>
#include <stdint.h>

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

#include "base/callback_list.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/domicile/domicile_desk_presenters.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/web_applications/web_app_helpers.h"
#include "components/domicile/browser/desk_geometry.h"
#include "components/domicile/browser/shell_windows.h"
#include "components/domicile/common/domicile_scheme.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/domicile_desk.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/base/base_window.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/base/window_open_disposition.h"
#include "ui/display/display.h"
#include "ui/display/display_observer.h"
#include "ui/display/screen.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"
#include "ui/views/window/client_view.h"
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

// The one page a desk is, from the layout the compositor last stated and the
// displays there are now. `std::nullopt` before a layout names any of them.
struct Desk {
  DeskGeometry geometry;
  std::vector<DeskPlace> places;
};

std::optional<Desk> DeskOf(const std::vector<display::Display>& displays) {
  std::vector<DeskPlace> places;
  for (const content::DomicileDeskDisplay& lit : content::GetDomicileDesk()) {
    const auto found =
        std::ranges::find(displays, lit.id, &display::Display::id);
    if (found == displays.end()) {
      continue;
    }
    places.push_back(DeskPlace{.id = lit.id,
                               .desk = lit.desk,
                               .scale = lit.scale,
                               .refresh_hz = found->display_frequency()});
  }
  const std::optional<DeskGeometry> geometry = DeskGeometryOf(places);
  if (!geometry.has_value()) {
    return std::nullopt;
  }
  return Desk{.geometry = *geometry, .places = std::move(places)};
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

// Whether a shell page has committed in `browser`.
bool ShowsAShell(BrowserWindowInterface* browser) {
  tabs::TabInterface* tab = browser->GetActiveTabInterface();
  return tab != nullptr &&
         tab->GetContents()->GetLastCommittedURL().SchemeIs(kDomicileScheme);
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
        if (!ShowsAShell(browser)) {
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

// Every browser window with no shell page committed in it: among them, one
// this opened whose page is still loading. `ShellWindowPlaces::Update` takes
// these as `loading`.
std::vector<BrowserWindowInterface*> WindowsStillLoading() {
  std::vector<BrowserWindowInterface*> found;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&found](BrowserWindowInterface* browser) {
        if (!ShowsAShell(browser)) {
          found.push_back(browser);
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return found;
}

std::vector<uintptr_t> IdentitiesOf(
    const std::vector<BrowserWindowInterface*>& windows) {
  std::vector<uintptr_t> identities;
  identities.reserve(windows.size());
  for (BrowserWindowInterface* window : windows) {
    identities.push_back(Identity(window));
  }
  return identities;
}

// Puts `window` on `pixels`, a display's bounds.
//
// IN PIXELS, AND STRAIGHT TO THE HOST. A display's bounds are its CRTC's on
// this platform, scale or no scale -- drm_screen.h says why -- and
// `BaseWindow::SetBounds` takes DIPs, which it would multiply by the scale
// into a rectangle no CRTC has.
void FitTo(BrowserWindowInterface* window, const gfx::Rect& pixels) {
  window->GetWindow()->GetNativeWindow()->GetHost()->SetBoundsInPixels(pixels);
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

// Says when the page in a shell window has arrived or been replaced.
//
// WHAT LIGHTS A COLD DESK. The first reconciliation runs at
// `PostBrowserStart`, before the shell's page has committed, so there is no
// page to lay out or present yet; the page arriving is what asks again. And a
// renderer that died and came back is a new view, which every presenter has to
// mirror instead of the old one.
class ShellPageWatch : public content::WebContentsObserver {
 public:
  ShellPageWatch(content::WebContents* contents, base::RepeatingClosure changed)
      : content::WebContentsObserver(contents), changed_(std::move(changed)) {}

  // content::WebContentsObserver:
  void PrimaryPageChanged(content::Page&) override { changed_.Run(); }
  void RenderViewReady() override { changed_.Run(); }

 private:
  base::RepeatingClosure changed_;
};

// Keeps the one shell page on the fastest display, laid out over the desk and
// presented on every other display, through startup and every hotplug. See
// docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
class ShellWindows : public display::DisplayObserver {
 public:
  ShellWindows()
      : desk_laid_out_(content::AddDomicileDeskObserver(
            base::BindRepeating(&ShellWindows::ReconcileSoon,
                                // A NoDestructor, as `ReconcileSoon` says.
                                base::Unretained(this)))) {
    display::Screen::Get()->AddObserver(this);
    Reconcile();
  }

  ShellWindows(const ShellWindows&) = delete;
  ShellWindows& operator=(const ShellWindows&) = delete;

  ~ShellWindows() override = default;

  // display::DisplayObserver:
  void OnDisplayAdded(const display::Display&) override { ReconcileSoon(); }

  void OnDisplaysRemoved(const display::Displays&) override { ReconcileSoon(); }

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
    const std::vector<BrowserWindowInterface*> loading = WindowsStillLoading();
    // Through the places rather than off the sighting, because the sighting is
    // exactly what a bounds change has just invalidated: the display moved,
    // and the window that belongs on it is still where it was.
    places_.Update(SightingsOf(held), IdentitiesOf(loading));
    // A WINDOW STILL LOADING ITS PAGE FOLLOWS TOO. A monitor arriving is a
    // display added and then moved, once the compositor's layout names it --
    // and the window opened for it is loading its page in between.
    std::vector<BrowserWindowInterface*> windows = loading;
    for (const ShellWindow& one : held) {
      windows.push_back(one.window);
    }
    for (BrowserWindowInterface* window : windows) {
      if (places_.Of(Identity(window)) == display.id()) {
        FitTo(window, display.bounds());
      }
    }
    // And the presenter on it, which is only a window the reconciliation
    // knows about.
    ReconcileSoon();
  }

 private:
  // Reconciles once the display list has finished changing.
  //
  // NOT FROM INSIDE THE CHANGE. `DrmScreen` lays a reading into its list one
  // display at a time and removes the unplugged ones last, and it is from the
  // middle of that that `OnDisplayAdded` is called: a reconciliation there
  // reads a desk that is half the old one, and opens a window at a rectangle
  // the next line moves. One task later the whole reading is in, and a burst
  // of additions is one reconciliation.
  void ReconcileSoon() {
    if (reconcile_posted_) {
      return;
    }
    reconcile_posted_ = true;
    // `base::Unretained` for the reason `Open` gives: a NoDestructor that
    // lives as long as the browser.
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&ShellWindows::ReconcilePosted, base::Unretained(this)));
  }

  void ReconcilePosted() {
    reconcile_posted_ = false;
    Reconcile();
  }

  void Reconcile() {
    CHECK_CURRENTLY_ON(content::BrowserThread::UI);
    if (!display::Screen::HasScreen()) {
      return;
    }
    const std::vector<ShellWindow> held = ShellWindowsNow();
    const std::vector<BrowserWindowInterface*> loading = WindowsStillLoading();
    // THE DISPLAY EACH WINDOW IS ON, WHICH IS NOT THE DISPLAY ITS RECTANGLE
    // READS AS. A hotplug moves the desk's origins before the windows follow
    // them; reading the rectangles here is what used to open a second window
    // on one monitor and leave another dark. `ShellWindowPlaces` says why at
    // length.
    const std::vector<int64_t> placed =
        places_.Update(SightingsOf(held), IdentitiesOf(loading));
    std::vector<int64_t> windowed = placed;
    windowed.reserve(held.size() + loading.size() + opening_.size());
    // A WINDOW LOADING ITS PAGE COUNTS AS A WINDOW, for the reason the one
    // being made does below: its display is covered, and read as bare it got
    // a second window.
    for (BrowserWindowInterface* window : loading) {
      const int64_t on = places_.Of(Identity(window));
      if (on != display::kInvalidDisplayId) {
        windowed.push_back(on);
      }
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
    const std::vector<display::Display> all =
        display::Screen::Get()->GetAllDisplays();
    // ONE PAGE IS ONE WINDOW, on the display that hosts it; the others are
    // presenters. Before the compositor states a layout there is no desk to
    // host, and the primary holds the page until there is.
    const std::optional<Desk> desk = DeskOf(all);
    std::vector<display::Display> displays = all;
    if (!all.empty()) {
      const int64_t host =
          desk.has_value() ? desk->geometry.host : all.front().id();
      std::erase_if(displays, [host](const display::Display& display) {
        return display.id() != host;
      });
    }
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
    Watch();
    Present(desk, all);
  }

  // Watches every browser window's page, so the page arriving or being
  // replaced reconciles. A watch whose contents went away is dropped.
  void Watch() {
    std::erase_if(watches_, [](const std::unique_ptr<ShellPageWatch>& watch) {
      return watch->web_contents() == nullptr;
    });
    GlobalBrowserCollection::GetInstance()->ForEach(
        [this](BrowserWindowInterface* browser) {
          tabs::TabInterface* tab = browser->GetActiveTabInterface();
          if (tab == nullptr) {
            return true;
          }
          content::WebContents* contents = tab->GetContents();
          if (std::ranges::none_of(
                  watches_,
                  [contents](const std::unique_ptr<ShellPageWatch>& watch) {
                    return watch->web_contents() == contents;
                  })) {
            watches_.push_back(std::make_unique<ShellPageWatch>(
                contents,
                // A NoDestructor, as `ReconcileSoon` says.
                base::BindRepeating(&ShellWindows::ReconcileSoon,
                                    base::Unretained(this))));
          }
          return true;
        },
        BrowserCollection::Order::kCreation);
  }

  // Lays the host's page out over the desk, and shows it on every other
  // display. Asked on every reconciliation, because each of what it reads --
  // the layout, the displays, the host's page and its renderer -- changes one
  // of them.
  void Present(const std::optional<Desk>& desk,
               const std::vector<display::Display>& all) {
    BrowserWindowInterface* host = nullptr;
    if (desk.has_value()) {
      for (const ShellWindow& one : ShellWindowsNow()) {
        if (places_.Of(Identity(one.window)) == desk->geometry.host) {
          host = one.window;
          break;
        }
      }
    }
    if (host == nullptr) {
      ui::OzonePlatform::GetInstance()->SetDomicileDeskHost(
          gfx::kNullAcceleratedWidget);
      presenters_.Present(nullptr, {});
      return;
    }
    const auto on_host =
        std::ranges::find(desk->places, desk->geometry.host, &DeskPlace::id);
    gfx::NativeWindow window = host->GetWindow()->GetNativeWindow();
    // Every pointer and key, on whichever monitor, is the page's.
    ui::OzonePlatform::GetInstance()->SetDomicileDeskHost(
        window->GetHost()->GetAcceleratedWidget());
    const gfx::Rect page = PageBoundsOn(*on_host, desk->geometry.box);
    if (content::GetDomicileDeskPageBounds(window) != page) {
      content::SetDomicileDeskPageBounds(window, page);
      views::Widget::GetWidgetForNativeWindow(window)
          ->client_view()
          ->InvalidateLayout();
    }
    content::WebContents* contents =
        host->GetActiveTabInterface()->GetContents();
    content::SetDomicileDeskScreenInfos(
        contents,
        DeskScreenInfos(desk->geometry,
                        display::Screen::Get()
                            ->GetScreenInfosNearestDisplay(desk->geometry.host)
                            .current()));

    std::vector<Presented> presented;
    for (const DeskPlace& place : desk->places) {
      if (place.id == desk->geometry.host) {
        continue;
      }
      const auto found =
          std::ranges::find(all, place.id, &display::Display::id);
      presented.push_back(
          Presented{.display = place.id,
                    .pixels = found->bounds(),
                    .page = PageBoundsOn(place, desk->geometry.box)});
    }
    presenters_.Present(contents, presented);
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
      // before the shell's own window has committed its URL. A shell page
      // loading asks again (`ShellPageWatch`), which is the soonest there is
      // anything to copy.
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
      LOG(ERROR) << "domicile: no shell window for display " << id
                 << "; it stays dark until something asks again";
      return;
    }
    // BEFORE THE PAGE IS LOADED, because its loading reconciles and the
    // reconciliation has to know which display it is on. Recorded outright
    // rather than left to the first sighting:
    // the window is placed on `id` by its bounds, and a hotplug between now
    // and the next reading would make that rectangle say something else.
    places_.Place(Identity(window), id);
    // WHERE THE DISPLAY IS NOW, not where it was when the window was asked
    // for. A monitor arriving moves while its window is being made -- it is
    // added, then placed once the compositor's layout names it -- and a
    // window left at the rectangle it was asked for is on no CRTC's --
    // `OnDisplayMetricsChanged` cannot move a window that did not exist yet.
    const std::vector<display::Display> displays =
        display::Screen::Get()->GetAllDisplays();
    const auto now = std::ranges::find(displays, id, &display::Display::id);
    if (now == displays.end()) {
      // Gone before its window came. The window is still recorded as its, so
      // the reconciliation its page asks for closes it.
      VLOG(1) << "domicile: display " << id << " went before its window came";
    } else {
      FitTo(window, now->bounds());
    }
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
  // Whether a `ReconcilePosted` is already on its way.
  bool reconcile_posted_ = false;
  // Which display each window is on.
  ShellWindowPlaces places_;
  // The windows showing the host's page on every other display.
  DeskPresenters presenters_;
  // One per browser window's contents, so a page arriving reconciles.
  std::vector<std::unique_ptr<ShellPageWatch>> watches_;
  base::CallbackListSubscription desk_laid_out_;
};

}  // namespace

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
