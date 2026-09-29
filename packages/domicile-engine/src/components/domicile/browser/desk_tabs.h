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

// The chrome.tabs and chrome.windows calls a desk refuses rather than fakes,
// by the name ExtensionFunctionRegistry knows them under.
//
// A move, a group, a split, a duplicate, a discard, a second window: none has
// a desktop meaning, and a call that answered success and did nothing would be
// a bug the extension cannot see. The zoom four are here for a different
// reason -- Chrome's reach for a ZoomController a guest does not have -- and
// are the follow-up that could come out.
base::span<const char* const> RefusedOnDesk();
bool IsRefusedOnDesk(std::string_view function_name);

// Whether a guest showing a page of `scheme` becomes the active tab when it is
// focused. Not an extension's page: a popup is in a <webview> like any window,
// and one that took the active tab would answer its own tabs.query with itself.
bool TakesActiveOnFocus(std::string_view scheme);

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

// A tab, as much of it as a query compares.
struct DeskTabFacts {
  bool active = false;
  int index = -1;
  int window_id = -1;
  bool audible = false;
  bool muted = false;
  std::string status;
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

// Whether `query` names `tab`. The desk is the one window, so it is every
// query's current and last-focused one and its type is `normal`; a desk tab
// is highlighted exactly when it is active, and is never pinned, grouped,
// split, frozen or discarded.
bool DeskTabMatches(const DeskTabQuery& query, const DeskTabFacts& tab);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_TABS_H_
