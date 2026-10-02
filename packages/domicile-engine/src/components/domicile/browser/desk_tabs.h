// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_TABS_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_TABS_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/containers/span.h"

namespace domicile {

// What chrome.tabs sees of a desk, decided with no browser: which <webview> is
// the active tab, which calls are refused, and which tabs a query names.
// docs/architecture/EXTENSIONS.md's slice 2. Carrying it out -- the window
// controller, the guests, the events -- is //chrome/browser/domicile/
// domicile_desk.h.

// The error every refused call answers with.
inline constexpr char kNotOnADesk[] = "not supported on a Domicile desk";

// `windowId: chrome.windows.WINDOW_ID_CURRENT`, which is extension_misc's and
// spelled again here because this target depends on nothing of //extensions.
inline constexpr int kCurrentWindowId = -2;

// The chrome.tabs calls a desk refuses rather than fakes, by the name
// ExtensionFunctionRegistry knows them under.
//
// A move, a group, a split, a duplicate, a discard: none has a desktop
// meaning, and a call that answered success and did nothing would be a bug the
// extension cannot see.
base::span<const char* const> RefusedOnDesk();
bool IsRefusedOnDesk(std::string_view function_name);

// tabs.setZoom's `zoomFactor` as the factor a desk tab is zoomed to, or
// nothing where the desk refuses it. 0 or less is `default_factor`, as in
// Chrome. Outside [minimum, maximum] -- blink's browser zoom range, which the
// <webview> element holds its own setZoom to -- is refused rather than stored.
std::optional<double> DeskZoomFactor(double asked,
                                     double default_factor,
                                     double minimum,
                                     double maximum);

// Whether a desk tab takes tabs.setZoomSettings' `mode` and `scope`, each ""
// where left out. A guest's zoom is HostZoomMap's, per site: Chrome's
// automatic, per-origin mode, and the only one a desk has.
bool DeskTakesZoomSettings(std::string_view mode, std::string_view scope);

// Whether a guest showing a page of `scheme` becomes the active tab when it is
// focused. Not an extension's page: a popup is in a <webview> like any window,
// and one that took the active tab would answer its own tabs.query with itself.
bool TakesActiveOnFocus(std::string_view scheme);

// windows.create's createData, as much of it as decides whether a desk opens
// the window. Each string is "" where it was left out.
struct DeskWindowCreate {
  std::string type;
  int urls = 0;
  bool tab_id = false;
  bool incognito = false;
  std::string state;
  bool set_self_as_opener = false;
};

// Whether a desk opens the window `create` asks for: a popup -- `popup`, or
// Chrome's deprecated `panel`, which it opens as one -- at one address, in a
// normal state. That is what an extension opens for a page of its own, like
// Bitwarden's sign-in, and the shell draws it as a window of its own.
//
// Not a normal window: the shell's browser windows are the desk's tabs, and
// tabs.create already asks for one. Not a tab moved into it, an opener, a
// second address or an incognito profile, none of which the shell can make.
// Its bounds decide nothing: a size is the shell's to honor, and a position
// is the shell's to choose, as it is on a Wayland desktop in Chrome itself.
bool DeskOpensWindow(const DeskWindowCreate& create);

// The desk's tabs, by the id SessionTabHelper gave each: in creation order,
// which is their index, and in order of focus, which is what the active one is.
class DeskTabs {
 public:
  DeskTabs();
  DeskTabs(const DeskTabs&) = delete;
  DeskTabs& operator=(const DeskTabs&) = delete;
  ~DeskTabs();

  // A tab nobody has focused goes behind every tab somebody has.
  void Add(int tab_id);
  void Remove(int tab_id);
  void Focus(int tab_id);

  // The tab that last had focus, the first made when none has, or nothing on
  // a desk with no tabs.
  std::optional<int> Active() const;

  int IndexOf(int tab_id) const;
  const std::vector<int>& InCreationOrder() const { return created_; }

 private:
  std::vector<int> created_;
  // Least recently focused first; the last is the active tab.
  std::vector<int> focused_;
};

// A tab, as much of it as a query compares. `active` and `index` are within
// its own window: the desk's, or a popup window an extension opened.
struct DeskTabFacts {
  bool active = false;
  int index = -1;
  int window_id = -1;
  bool audible = false;
  bool muted = false;
  std::string status;
  // `normal` for the desk's, `popup` for a popup window's.
  std::string window_type;
  // Whether the tab's window is the asker's current one, and the one that last
  // had focus.
  bool in_current_window = false;
  bool in_last_focused_window = false;
};

// chrome.tabs.query's queryInfo, less `url` and `title`: matching those needs
// URLPatternSet and a scrub decision, and both are //chrome's.
struct DeskTabQuery {
  DeskTabQuery();
  DeskTabQuery(const DeskTabQuery&);
  DeskTabQuery& operator=(const DeskTabQuery&);
  ~DeskTabQuery();

  std::optional<bool> active;
  std::optional<bool> highlighted;
  std::optional<bool> current_window;
  std::optional<bool> last_focused_window;
  std::optional<bool> pinned;
  std::optional<bool> audible;
  std::optional<bool> muted;
  std::optional<bool> discarded;
  std::optional<bool> frozen;
  std::optional<bool> auto_discardable;
  std::optional<int> window_id;
  std::optional<int> index;
  std::optional<int> group_id;
  std::optional<int> split_view_id;
  std::optional<std::string> status;
  std::optional<std::string> window_type;
};

// Whether `query` names `tab`. A desk tab is highlighted exactly when it is
// active, and is never pinned, grouped, split, frozen or discarded.
bool DeskTabMatches(const DeskTabQuery& query, const DeskTabFacts& tab);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_TABS_H_
