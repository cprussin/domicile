// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_WINDOW_CONTROLLER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_WINDOW_CONTROLLER_H_

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "base/containers/circular_deque.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/observer_list.h"
#include "base/supports_user_data.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/extensions/window_controller.h"
#include "chrome/common/extensions/api/tabs.h"
#include "components/domicile/browser/desk_tabs.h"
#include "components/sessions/core/session_id.h"
#include "ui/base/base_window.h"

class GURL;
class Profile;

namespace content {
class BrowserContext;
class WebContents;
}  // namespace content

namespace domicile {

// A window nobody draws, for WindowController, which must be handed one.
//
// The desk's window is the whole desktop, and the shell draws it; nothing in
// this process can show, move or resize it. So it answers what a window IS --
// active, visible, normal -- and does nothing for what a window is TOLD. The
// only calls that tell it anything are Chrome's chrome.windows functions, and
// the desk replaces every one of those (domicile_desk_functions.h).
class DeskWindow final : public ui::BaseWindow {
 public:
  // ui::BaseWindow:
  bool IsActive() const override;
  bool IsMaximized() const override;
  bool IsMinimized() const override;
  bool IsFullscreen() const override;
  gfx::NativeWindow GetNativeWindow() const override;
  gfx::Rect GetRestoredBounds() const override;
  ui::mojom::WindowShowState GetRestoredState() const override;
  gfx::Rect GetBounds() const override;
  void Show() override;
  void Hide() override;
  bool IsVisible() const override;
  void ShowInactive() override;
  void Close() override;
  void Activate() override;
  void Deactivate() override;
  void Maximize() override;
  void Minimize() override;
  void Restore() override;
  void SetBounds(const gfx::Rect& bounds) override;
  void FlashFrame(bool flash) override;
  ui::ZOrderLevel GetZOrderLevel() const override;
  void SetZOrderLevel(ui::ZOrderLevel order) override;
};

// Every desk tab's zoom settings. A guest's zoom is HostZoomMap's, per site:
// Chrome's automatic, per-origin mode, and the only one a desk tab takes (see
// //components/domicile:desk_tabs's DeskTakesZoomSettings).
extensions::api::tabs::ZoomSettings DeskZoomSettings();

// A chrome.windows window of a profile's desk. See domicile_desk.h.
//
// THE DESK'S OWN WINDOW, whose tabs are the profile's <webview>s, is one of
// these: type `normal`, and OWNED BY THE PROFILE, as its user data, so it goes
// when the profile does -- after every guest in it, which is what makes a tab
// outliving its window impossible rather than handled.
//
// AND SO IS EVERY POPUP WINDOW AN EXTENSION OPENED with windows.create: type
// `popup`, owned by the desk's window, and with one tab: the browser window
// opened for it. It goes when that tab does, or at windows.remove before it
// has one.
class DomicileWindowController final : public extensions::WindowController,
                                       public base::SupportsUserData::Data {
 public:
  // `profile`'s desk, made the first time it is asked for.
  static DomicileWindowController& For(Profile* profile);

  // `context`'s desk, or null where none was made.
  static DomicileWindowController* Find(content::BrowserContext* context);

  // Every window there is, desks' and popups', for ForEachTab.
  static std::vector<DomicileWindowController*> All();

  // A desk's own window.
  explicit DomicileWindowController(Profile* profile);
  DomicileWindowController(const DomicileWindowController&) = delete;
  DomicileWindowController& operator=(const DomicileWindowController&) = delete;
  ~DomicileWindowController() override;

  // Make `guest` a tab: its window id, chrome.tabs.onCreated, and -- for the
  // first tab -- onActivated.
  void Add(content::WebContents& guest);

  // THE DESK'S WINDOW ONLY, from here to Popup's end: what it keeps of the
  // windows its extensions opened.
  //
  // Makes a popup window with no tab and fires chrome.windows.onCreated. The
  // caller opens a browser window as its tab.
  DomicileWindowController& OpenPopup();

  // The popup window `window_id` while it awaits its tab. Null when there is
  // no such window or it has a tab.
  DomicileWindowController* PopupAwaitingTab(int window_id) const;

  // Close the popup window `window_id`, which has no tab: chrome.windows.
  // onRemoved, and whoever waits on its tab hears that it never came.
  void ClosePopup(int window_id);

  // This window and its popups', in the order made.
  std::vector<DomicileWindowController*> Windows() const;

  // The window `window_id`, or null where it is none of Windows().
  DomicileWindowController* WindowWithId(int window_id) const;

  // The window with tab `tab_id`, or null where none has it.
  DomicileWindowController* WindowWithTab(int tab_id) const;

  // The window `contents` is a tab of, or null where it is no tab.
  DomicileWindowController* WindowOf(content::WebContents& contents) const;

  // chrome.windows.getLastFocused's answer: the window whose tab last took
  // focus, by DeskTabs' rule for the desk's own. This one until any has.
  DomicileWindowController& LastFocused() const;

  // Whether this is a popup window rather than a desk's own.
  bool IsPopup() const { return desk_ != nullptr; }

  // The tab `tab_id`, or null where this desk has none.
  content::WebContents* TabWithId(int tab_id) const;

  // Whether `contents` is one of this desk's tabs.
  bool Contains(content::WebContents& contents) const;

  // Where `tab` is, and whether it is the active tab. `tab` must be one.
  int IndexOf(content::WebContents& tab) const;
  bool IsActive(content::WebContents& tab) const;

  // Hear the next tab this window gains, once: tabs.create's and
  // windows.create's answer, since the tab is made elsewhere. In the
  // order asked. Null for a popup window closed before it had one.
  void WhenNextTab(base::OnceCallback<void(content::WebContents*)> gained);

  void AddObserver(DeskObserver* observer);
  void RemoveObserver(DeskObserver* observer);

  // extensions::WindowController:
  int GetWindowId() const override;
  std::string GetWindowTypeText() const override;
  void SetFullscreenMode(bool is_fullscreen,
                         const GURL& extension_url) const override;
  content::WebContents* GetActiveTab() const override;
  int GetTabCount() const override;
  content::WebContents* GetWebContentsAt(int i) const override;
  bool IsVisibleToTabsAPIForExtension(
      const extensions::Extension* extension,
      bool include_dev_tools_windows) const override;
  base::DictValue CreateWindowValueForExtension(
      const extensions::Extension* extension,
      PopulateTabBehavior populate_tab_behavior,
      extensions::mojom::ContextType context) const override;
  base::ListValue CreateTabList(
      const extensions::Extension* extension,
      extensions::mojom::ContextType context) const override;
  bool OpenOptionsPage(const extensions::Extension* extension,
                       const GURL& url,
                       bool open_in_tab) override;

 private:
  class Tab;

  // A popup window of `desk`.
  DomicileWindowController(Profile* profile, DomicileWindowController& desk);

  // What a popup window says to its desk: its tab took focus, and it is
  // closing because its tab has gone. The second deletes the popup.
  void PopupFocused(int window_id);
  void PopupEmptied(int window_id);

  // windows.onCreated or onRemoved, for `window`.
  void BroadcastWindowEvent(DomicileWindowController& window, bool created);

  // What a tab says about itself, each from its guest.
  void Focused(int tab_id, content::WebContents& tab);
  void Updated(int tab_id, std::set<std::string> changed);
  void Zoomed(int tab_id, double old_factor, double new_factor);
  // Deletes the Tab calling it.
  void Removed(int tab_id);

  // onActivated and the observers, if the active tab is not `before`.
  void ActiveMaybeChanged(std::optional<int> before);

  DeskWindow window_;
  const SessionID session_id_;
  // The desk's window, for a popup; null for the desk's own.
  const raw_ptr<DomicileWindowController> desk_;
  DeskTabs tabs_;
  std::map<int, std::unique_ptr<Tab>> by_id_;
  base::circular_deque<base::OnceCallback<void(content::WebContents*)>>
      waiting_for_tab_;
  base::ObserverList<DeskObserver> observers_;

  // The desk's own only: its popup windows by id, which map order is the
  // order made because a SessionID only grows, and the window that last had
  // focus.
  std::map<int, std::unique_ptr<DomicileWindowController>> popups_;
  int last_focused_ = -1;
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_WINDOW_CONTROLLER_H_
