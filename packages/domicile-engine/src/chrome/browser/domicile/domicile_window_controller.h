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
#include "base/observer_list.h"
#include "base/supports_user_data.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/extensions/window_controller.h"
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

// A profile's desk, as chrome.windows sees it: one window, whose tabs are the
// profile's <webview>s. See domicile_desk.h.
//
// OWNED BY THE PROFILE, as its user data, so it goes when the profile does --
// after every guest in it, which is what makes a tab outliving its window
// impossible rather than handled.
class DomicileWindowController final : public extensions::WindowController,
                                       public base::SupportsUserData::Data {
 public:
  // `profile`'s desk, made the first time it is asked for.
  static DomicileWindowController& For(Profile* profile);

  // `context`'s desk, or null where none was made.
  static DomicileWindowController* Find(content::BrowserContext* context);

  // Every desk there is, for ForEachTab.
  static std::vector<DomicileWindowController*> All();

  explicit DomicileWindowController(Profile* profile);
  DomicileWindowController(const DomicileWindowController&) = delete;
  DomicileWindowController& operator=(const DomicileWindowController&) = delete;
  ~DomicileWindowController() override;

  // Make `guest` a tab: its window id, chrome.tabs.onCreated, and -- for the
  // first tab -- onActivated.
  void Add(content::WebContents& guest);

  // The tab `tab_id`, or null where this desk has none.
  content::WebContents* TabWithId(int tab_id) const;

  // Whether `contents` is one of this desk's tabs.
  bool Contains(content::WebContents& contents) const;

  // Where `tab` is, and whether it is the active tab. `tab` must be one.
  int IndexOf(content::WebContents& tab) const;
  bool IsActive(content::WebContents& tab) const;

  // Hear the next tab this desk gains, once: tabs.create's answer, since the
  // tab is the shell's to make. In the order asked.
  void WhenNextTab(base::OnceCallback<void(content::WebContents&)> gained);

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

  // What a tab says about itself, each from its guest.
  void Focused(int tab_id, content::WebContents& tab);
  void Updated(int tab_id, std::set<std::string> changed);
  // Deletes the Tab calling it.
  void Removed(int tab_id);

  // onActivated and the observers, if the active tab is not `before`.
  void ActiveMaybeChanged(std::optional<int> before);

  DeskWindow window_;
  const SessionID session_id_;
  DeskTabs tabs_;
  std::map<int, std::unique_ptr<Tab>> by_id_;
  base::circular_deque<base::OnceCallback<void(content::WebContents&)>>
      waiting_for_tab_;
  base::ObserverList<DeskObserver> observers_;
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_WINDOW_CONTROLLER_H_
