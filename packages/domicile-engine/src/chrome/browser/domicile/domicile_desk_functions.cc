// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_functions.h"

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/strings/pattern.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "chrome/browser/domicile/domicile_window_controller.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/common/extensions/api/tabs.h"
#include "chrome/common/extensions/api/windows.h"
#include "components/domicile/browser/desk_tabs.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/host_zoom_map.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_function.h"
#include "extensions/browser/extension_function_registry.h"
#include "extensions/common/error_utils.h"
#include "extensions/common/extension.h"
#include "extensions/common/permissions/permissions_data.h"
#include "extensions/common/url_pattern.h"
#include "extensions/common/url_pattern_set.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "url/gurl.h"

namespace domicile {
namespace {

namespace tabs = extensions::api::tabs;
namespace windows = extensions::api::windows;
using extensions::ExtensionTabUtil;

// Matches Chrome's message, so extensions that match on it still work.
constexpr char kTabNotFoundError[] = "No tab with id: *.";

// Returned when the desk has no tab to ask the shell through.
constexpr char kNoWindowToAskError[] =
    "No browser window on this Domicile desk to ask the shell through.";

// Returned for a zoom factor outside blink's browser range, which the
// <webview> element's own setZoom also enforces.
constexpr char kZoomOutOfRangeError[] =
    "Zoom factor * is outside the range a Domicile desk zooms to.";

// The desk of the calling profile, or null.
DomicileWindowController* DeskOf(ExtensionFunction& function) {
  return DomicileWindowController::Find(function.browser_context());
}

// chrome.windows' "current" window: the caller's tab's window, or the desk's
// window for a caller with no tab (such as a service worker). Null with no
// desk.
DomicileWindowController* CurrentWindowOf(ExtensionFunction& function) {
  DomicileWindowController* desk = DeskOf(function);
  if (desk == nullptr) {
    return nullptr;
  }
  content::WebContents* sender = function.GetSenderWebContents();
  DomicileWindowController* window =
      sender == nullptr ? nullptr : desk->WindowOf(*sender);
  return window == nullptr ? desk : window;
}

// The window `window_id` names, including kCurrentWindowId, or null.
DomicileWindowController* WindowNamed(ExtensionFunction& function,
                                      int window_id) {
  DomicileWindowController* desk = DeskOf(function);
  if (desk == nullptr) {
    return nullptr;
  }
  return window_id == kCurrentWindowId ? CurrentWindowOf(function)
                                       : desk->WindowWithId(window_id);
}

std::string WindowNotFound(int window_id) {
  return extensions::ErrorUtils::FormatErrorMessage(
      ExtensionTabUtil::kWindowNotFoundError, base::NumberToString(window_id));
}

// The tab with `tab_id` in any window, or the current window's active tab
// when `tab_id` is unset (Chrome's default). Null if neither exists.
content::WebContents* TabOrActive(ExtensionFunction& function,
                                  std::optional<int> tab_id) {
  DomicileWindowController* desk = DeskOf(function);
  if (desk == nullptr) {
    return nullptr;
  }
  if (!tab_id.has_value()) {
    return CurrentWindowOf(function)->GetActiveTab();
  }
  DomicileWindowController* window = desk->WindowWithTab(*tab_id);
  return window == nullptr ? nullptr : window->TabWithId(*tab_id);
}

std::string TabNotFound(std::optional<int> tab_id) {
  return extensions::ErrorUtils::FormatErrorMessage(
      kTabNotFoundError, base::NumberToString(tab_id.value_or(-1)));
}

WebViewGuest& GuestOf(content::WebContents& tab) {
  WebViewGuest* guest = WebViewGuest::FromWebContents(&tab);
  CHECK(guest);
  return *guest;
}

// The profile's default zoom, which `tabs.setZoom(id, 0)` restores.
double DefaultZoomFactor(content::WebContents& tab) {
  return blink::ZoomLevelToZoomFactor(
      content::HostZoomMap::GetForWebContents(&tab)->GetDefaultZoomLevel());
}

base::Value TabValue(ExtensionFunction& function, content::WebContents& tab) {
  return base::Value(
      ExtensionTabUtil::CreateTabObject(
          &tab,
          ExtensionTabUtil::GetScrubTabBehavior(
              function.extension(), function.source_context_type(), &tab),
          function.extension())
          .ToValue());
}

// Converts queryInfo for //components/domicile:desk_tabs.
DeskTabQuery AsDeskTabQuery(const tabs::Query::Params::QueryInfo& info) {
  DeskTabQuery query;
  query.active = info.active;
  query.highlighted = info.highlighted;
  query.current_window = info.current_window;
  query.last_focused_window = info.last_focused_window;
  query.pinned = info.pinned;
  query.audible = info.audible;
  query.muted = info.muted;
  query.discarded = info.discarded;
  query.frozen = info.frozen;
  query.auto_discardable = info.auto_discardable;
  query.window_id = info.window_id;
  query.index = info.index;
  query.group_id = info.group_id;
  query.split_view_id = info.split_view_id;
  if (info.status != tabs::TabStatus::kNone) {
    query.status = std::string(tabs::ToString(info.status));
  }
  if (info.window_type != tabs::WindowType::kNone) {
    query.window_type = std::string(tabs::ToString(info.window_type));
  }
  return query;
}

// The facts a query compares about `tab`, relative to `current`.
DeskTabFacts FactsOf(DomicileWindowController& desk,
                     DomicileWindowController& window,
                     DomicileWindowController& current,
                     content::WebContents& tab) {
  return DeskTabFacts{
      .active = window.IsActive(tab),
      .index = window.IndexOf(tab),
      .window_id = window.GetWindowId(),
      .audible = tab.IsCurrentlyAudible(),
      .muted = tab.IsAudioMuted(),
      .status =
          std::string(tabs::ToString(ExtensionTabUtil::GetLoadingStatus(&tab))),
      .window_type = window.GetWindowTypeText(),
      .in_current_window = &window == &current,
      .in_last_focused_window = &window == &desk.LastFocused()};
}

// Matches the privileged `title` and `url` filters. A tab the extension may
// not read matches neither, as in TabsQueryFunction::MatchesTab.
bool MatchesPrivileged(ExtensionFunction& function,
                       const tabs::Query::Params::QueryInfo& info,
                       const extensions::URLPatternSet& url_patterns,
                       content::WebContents& tab) {
  const ExtensionTabUtil::ScrubTabBehavior scrub =
      ExtensionTabUtil::GetScrubTabBehavior(
          function.extension(), function.source_context_type(), &tab);
  const bool may_read =
      scrub.committed_info != ExtensionTabUtil::kScrubTabFully;
  if (info.title && !info.title->empty() &&
      !(may_read &&
        base::MatchPattern(tab.GetTitle(), base::UTF8ToUTF16(*info.title)))) {
    return false;
  }
  if (url_patterns.is_empty()) {
    return true;
  }
  content::NavigationEntry* pending = tab.GetController().GetPendingEntry();
  return (may_read && url_patterns.MatchesURL(tab.GetLastCommittedURL())) ||
         (pending != nullptr &&
          scrub.pending_info != ExtensionTabUtil::kScrubTabFully &&
          url_patterns.MatchesURL(pending->GetVirtualURL()));
}

// Answers every function in RefusedOnDesk() with kNotOnADesk.
class DeskRefusalFunction : public ExtensionFunction {
 private:
  ~DeskRefusalFunction() override = default;

  ResponseAction Run() override { return RespondNow(Error(kNotOnADesk)); }
};

class DeskTabsQueryFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.query", TABS_QUERY)

 private:
  ~DeskTabsQueryFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::Query::Params> params =
        tabs::Query::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    const tabs::Query::Params::QueryInfo& info = params->query_info;

    // SCHEME_ALL, as in Chrome: matching grants no access.
    std::vector<std::string> patterns;
    if (info.url && info.url->as_string) {
      patterns.push_back(*info.url->as_string);
    } else if (info.url && info.url->as_strings) {
      patterns = *info.url->as_strings;
    }
    extensions::URLPatternSet url_patterns;
    std::string error;
    if (!url_patterns.Populate(patterns, URLPattern::SCHEME_ALL,
                               true, &error)) {
      return RespondNow(Error(std::move(error)));
    }

    const DeskTabQuery query = AsDeskTabQuery(info);
    base::ListValue result;
    DomicileWindowController* desk = DeskOf(*this);
    if (desk == nullptr) {
      return RespondNow(WithArguments(std::move(result)));
    }
    DomicileWindowController& current = *CurrentWindowOf(*this);
    for (DomicileWindowController* window : desk->Windows()) {
      for (int i = 0; i < window->GetTabCount(); ++i) {
        content::WebContents& tab = *window->GetWebContentsAt(i);
        if (DeskTabMatches(query, FactsOf(*desk, *window, current, tab)) &&
            MatchesPrivileged(*this, info, url_patterns, tab)) {
          result.Append(TabValue(*this, tab));
        }
      }
    }
    return RespondNow(WithArguments(std::move(result)));
  }
};

class DeskTabsUpdateFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.update", TABS_UPDATE)

 private:
  ~DeskTabsUpdateFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::Update::Params> params =
        tabs::Update::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    const auto& update = params->update_properties;

    // Refuse unsupported properties first so no update is half applied.
    if (update.pinned.value_or(false) || update.opener_tab_id ||
        update.auto_discardable) {
      return RespondNow(Error(kNotOnADesk));
    }

    content::WebContents* tab = TabOrActive(*this, params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(TabNotFound(params->tab_id)));
    }

    std::optional<GURL> url;
    if (update.url) {
      base::expected<GURL, std::string> prepared =
          ExtensionTabUtil::PrepareURLForNavigation(*update.url, extension(),
                                                    browser_context());
      if (!prepared.has_value()) {
        return RespondNow(Error(std::move(prepared.error())));
      }
      url = *prepared;
    }

    if (update.muted) {
      tab->SetAudioMuted(*update.muted);
    }
    if (url.has_value()) {
      GuestOf(*tab).Navigate(*url);
    }
    // The shell decides focus. The reply reflects the current state; the tab
    // becomes active once the shell focuses it.
    if (update.active.value_or(false) || update.highlighted.value_or(false) ||
        update.selected.value_or(false)) {
      GuestOf(*tab).RequestFocus();
    }
    return RespondNow(WithArguments(TabValue(*this, *tab)));
  }
};

class DeskTabsCreateFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.create", TABS_CREATE)

 private:
  ~DeskTabsCreateFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::Create::Params> params =
        tabs::Create::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    const auto& create = params->create_properties;

    // Placement, pinning, splitting and openers belong to the shell, and a
    // tab needs a URL to open as a browser window.
    DomicileWindowController* desk = DeskOf(*this);
    const bool on_desk =
        !create.window_id || *create.window_id == kCurrentWindowId ||
        (desk != nullptr && *create.window_id == desk->GetWindowId());
    if (!on_desk || create.index || create.pinned.value_or(false) ||
        create.opener_tab_id || create.split_with_tab_id || !create.url) {
      return RespondNow(Error(kNotOnADesk));
    }

    base::expected<GURL, std::string> url =
        ExtensionTabUtil::PrepareURLForNavigation(*create.url, extension(),
                                                  browser_context());
    if (!url.has_value()) {
      return RespondNow(Error(std::move(url.error())));
    }

    content::WebContents* asker =
        desk == nullptr ? nullptr : desk->GetActiveTab();
    if (asker == nullptr) {
      return RespondNow(Error(kNoWindowToAskError));
    }
    // The new tab is the next one the desk gains; this function is retained
    // until then. RequestWindow usually opens it synchronously, so this has
    // often already responded.
    desk->WhenNextTab(base::BindOnce(&DeskTabsCreateFunction::Created,
                                     base::WrapRefCounted(this)));
    GuestOf(*asker).RequestWindow(*url);
    return did_respond() ? AlreadyResponded() : RespondLater();
  }

  // Never null: the desk's own window is never closed.
  void Created(content::WebContents* tab) {
    CHECK(tab);
    Respond(WithArguments(TabValue(*this, *tab)));
  }
};

class DeskTabsRemoveFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.remove", TABS_REMOVE)

 private:
  ~DeskTabsRemoveFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::Remove::Params> params =
        tabs::Remove::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    std::vector<int> ids;
    if (params->tab_ids.as_integers) {
      ids = *params->tab_ids.as_integers;
    } else {
      EXTENSION_FUNCTION_VALIDATE(params->tab_ids.as_integer);
      ids.push_back(*params->tab_ids.as_integer);
    }

    // Resolve every id first so one bad id closes nothing.
    std::vector<content::WebContents*> found;
    for (int id : ids) {
      content::WebContents* tab = TabOrActive(*this, id);
      if (tab == nullptr) {
        return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
            kTabNotFoundError, base::NumberToString(id))));
      }
      found.push_back(tab);
    }
    // Not awaited: closing is asynchronous, and tabs.onRemoved reports it.
    for (content::WebContents* tab : found) {
      GuestOf(*tab).RequestClose();
    }
    return RespondNow(NoArguments());
  }
};

// The zoom functions act on the guest's per-site zoom in HostZoomMap, the same
// zoom the element's setZoom sets, so the element sees every change.
class DeskTabsSetZoomFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.setZoom", TABS_SETZOOM)

 private:
  ~DeskTabsSetZoomFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::SetZoom::Params> params =
        tabs::SetZoom::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    content::WebContents* tab = TabOrActive(*this, params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(TabNotFound(params->tab_id)));
    }
    // As in Chrome, restricted pages cannot be zoomed.
    std::string error;
    if (extension()->permissions_data()->IsRestrictedUrl(
            tab->GetLastCommittedURL(), &error)) {
      return RespondNow(Error(std::move(error)));
    }
    const std::optional<double> factor = DeskZoomFactor(
        params->zoom_factor, DefaultZoomFactor(*tab),
        blink::kMinimumBrowserZoomFactor, blink::kMaximumBrowserZoomFactor);
    if (!factor.has_value()) {
      return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
          kZoomOutOfRangeError, base::NumberToString(params->zoom_factor))));
    }
    GuestOf(*tab).ZoomTo(*factor);
    return RespondNow(NoArguments());
  }
};

class DeskTabsGetZoomFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.getZoom", TABS_GETZOOM)

 private:
  ~DeskTabsGetZoomFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::GetZoom::Params> params =
        tabs::GetZoom::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    content::WebContents* tab = TabOrActive(*this, params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(TabNotFound(params->tab_id)));
    }
    return RespondNow(ArgumentList(
        tabs::GetZoom::Results::Create(GuestOf(*tab).GetZoomFactor())));
  }
};

// Accepts only the mode desk tabs already use, as a no-op; refuses others.
class DeskTabsSetZoomSettingsFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.setZoomSettings", TABS_SETZOOMSETTINGS)

 private:
  ~DeskTabsSetZoomSettingsFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::SetZoomSettings::Params> params =
        tabs::SetZoomSettings::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    content::WebContents* tab = TabOrActive(*this, params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(TabNotFound(params->tab_id)));
    }
    std::string error;
    if (extension()->permissions_data()->IsRestrictedUrl(
            tab->GetLastCommittedURL(), &error)) {
      return RespondNow(Error(std::move(error)));
    }
    const tabs::ZoomSettings& settings = params->zoom_settings;
    return RespondNow(DeskTakesZoomSettings(tabs::ToString(settings.mode),
                                            tabs::ToString(settings.scope))
                          ? NoArguments()
                          : Error(kNotOnADesk));
  }
};

class DeskTabsGetZoomSettingsFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("tabs.getZoomSettings", TABS_GETZOOMSETTINGS)

 private:
  ~DeskTabsGetZoomSettingsFunction() override = default;

  ResponseAction Run() override {
    std::optional<tabs::GetZoomSettings::Params> params =
        tabs::GetZoomSettings::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    content::WebContents* tab = TabOrActive(*this, params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(TabNotFound(params->tab_id)));
    }
    tabs::ZoomSettings settings = DeskZoomSettings();
    settings.default_zoom_factor = DefaultZoomFactor(*tab);
    return RespondNow(
        ArgumentList(tabs::GetZoomSettings::Results::Create(settings)));
  }
};

// Base for the chrome.windows reads over the desk's window and its popups.
class DeskWindowReadFunction : public ExtensionFunction {
 protected:
  ~DeskWindowReadFunction() override = default;

  // Responds with `window`, or an error when it is null (no desk).
  ResponseAction RespondWithWindow(
      DomicileWindowController* window,
      const std::optional<windows::QueryOptions>& options) {
    if (window == nullptr) {
      return RespondNow(Error(ExtensionTabUtil::kNoCurrentWindowError));
    }
    return RespondNow(WithArguments(WindowValue(*window, options)));
  }

  base::DictValue WindowValue(
      DomicileWindowController& window,
      const std::optional<windows::QueryOptions>& options) {
    return window.CreateWindowValueForExtension(
        extension(),
        options && options->populate.value_or(false)
            ? extensions::WindowController::kPopulateTabs
            : extensions::WindowController::kDontPopulateTabs,
        source_context_type());
  }
};

class DeskWindowsGetFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.get", WINDOWS_GET)

 private:
  ~DeskWindowsGetFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::Get::Params> params =
        windows::Get::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    DomicileWindowController* window = WindowNamed(*this, params->window_id);
    if (window == nullptr) {
      return RespondNow(Error(WindowNotFound(params->window_id)));
    }
    return RespondWithWindow(window, params->query_options);
  }
};

class DeskWindowsGetCurrentFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.getCurrent", WINDOWS_GETCURRENT)

 private:
  ~DeskWindowsGetCurrentFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::GetCurrent::Params> params =
        windows::GetCurrent::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    return RespondWithWindow(CurrentWindowOf(*this), params->query_options);
  }
};

class DeskWindowsGetLastFocusedFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.getLastFocused", WINDOWS_GETLASTFOCUSED)

 private:
  ~DeskWindowsGetLastFocusedFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::GetLastFocused::Params> params =
        windows::GetLastFocused::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    DomicileWindowController* desk = DeskOf(*this);
    return RespondWithWindow(desk == nullptr ? nullptr : &desk->LastFocused(),
                             params->query_options);
  }
};

class DeskWindowsGetAllFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.getAll", WINDOWS_GETALL)

 private:
  ~DeskWindowsGetAllFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::GetAll::Params> params =
        windows::GetAll::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    // Filter by `windowTypes` as Chrome does; without it, return every
    // window.
    const std::optional<std::vector<windows::WindowType>>& types =
        params->query_options ? params->query_options->window_types
                              : std::nullopt;
    base::ListValue all;
    if (DomicileWindowController* desk = DeskOf(*this)) {
      for (DomicileWindowController* window : desk->Windows()) {
        if (!types.has_value() ||
            window->MatchesFilter(
                extensions::WindowController::GetFilterFromWindowTypes(
                    *types))) {
          all.Append(WindowValue(*window, params->query_options));
        }
      }
    }
    return RespondNow(WithArguments(std::move(all)));
  }
};

class DeskWindowsUpdateFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.update", WINDOWS_UPDATE)

 private:
  ~DeskWindowsUpdateFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::Update::Params> params =
        windows::Update::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    const auto& update = params->update_info;

    // Bounds, state and attention belong to the shell; only focus can be
    // requested.
    if (update.left || update.top || update.width || update.height ||
        update.draw_attention || update.state != windows::WindowState::kNone ||
        !update.focused.value_or(true)) {
      return RespondNow(Error(kNotOnADesk));
    }
    DomicileWindowController* window = WindowNamed(*this, params->window_id);
    if (window == nullptr) {
      return RespondNow(Error(WindowNotFound(params->window_id)));
    }
    if (update.focused.value_or(false)) {
      content::WebContents* active = window->GetActiveTab();
      if (active == nullptr) {
        return RespondNow(Error(kNoWindowToAskError));
      }
      GuestOf(*active).RequestFocus();
    }
    return RespondNow(WithArguments(WindowValue(*window, std::nullopt)));
  }
};

// windows.create for a popup at one URL, which the shell draws.
// DeskOpensWindow in //components/domicile:desk_tabs decides what is refused.
//
// Creates the window with no tab, then asks the shell for a browser window as
// its tab. Responds once that tab attaches.
class DeskWindowsCreateFunction : public DeskWindowReadFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.create", WINDOWS_CREATE)

 private:
  ~DeskWindowsCreateFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::Create::Params> params =
        windows::Create::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    // No createData means a normal window at the new tab page.
    if (!params->create_data) {
      return RespondNow(Error(kNotOnADesk));
    }
    const windows::Create::Params::CreateData& create = *params->create_data;

    std::vector<std::string> urls;
    if (create.url && create.url->as_string) {
      urls.push_back(*create.url->as_string);
    } else if (create.url && create.url->as_strings) {
      urls = *create.url->as_strings;
    }
    const DeskWindowCreate asked{
        .type = create.type == windows::CreateType::kNone
                    ? std::string()
                    : std::string(windows::ToString(create.type)),
        .urls = static_cast<int>(urls.size()),
        .tab_id = create.tab_id.has_value(),
        .incognito = create.incognito.value_or(false),
        .state = create.state == windows::WindowState::kNone
                     ? std::string()
                     : std::string(windows::ToString(create.state)),
        .set_self_as_opener = create.set_self_as_opener.value_or(false)};
    if (!DeskOpensWindow(asked)) {
      return RespondNow(Error(kNotOnADesk));
    }

    base::expected<GURL, std::string> url =
        ExtensionTabUtil::PrepareURLForNavigation(urls.front(), extension(),
                                                  browser_context());
    if (!url.has_value()) {
      return RespondNow(Error(std::move(url.error())));
    }

    DomicileWindowController* desk = DeskOf(*this);
    content::WebContents* asker =
        desk == nullptr ? nullptr : desk->GetActiveTab();
    if (asker == nullptr) {
      return RespondNow(Error(kNoWindowToAskError));
    }
    DomicileWindowController& popup = desk->OpenPopup();
    // Retained until the window gets its tab or is removed. Usually responds
    // before RequestPopupWindow returns, as in tabs.create.
    popup.WhenNextTab(base::BindOnce(&DeskWindowsCreateFunction::Opened,
                                     base::WrapRefCounted(this),
                                     popup.GetWindowId()));
    GuestOf(*asker).RequestPopupWindow(popup.GetWindowId(), *url,
                                       create.width.value_or(0),
                                       create.height.value_or(0));
    return did_respond() ? AlreadyResponded() : RespondLater();
  }

  // Responds with the tabs populated, as Chrome's windows.create does.
  void Opened(int window_id, content::WebContents* tab) {
    if (tab == nullptr) {
      Respond(Error(WindowNotFound(window_id)));
      return;
    }
    DomicileWindowController* desk = DeskOf(*this);
    CHECK(desk);
    DomicileWindowController* popup = desk->WindowWithId(window_id);
    CHECK(popup);
    windows::QueryOptions populated;
    populated.populate = true;
    Respond(WithArguments(WindowValue(*popup, std::move(populated))));
  }
};

// windows.remove for a popup: closes its tab, which closes the window, or
// closes a tabless popup at once. The desk's own window cannot be removed.
class DeskWindowsRemoveFunction : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("windows.remove", WINDOWS_REMOVE)

 private:
  ~DeskWindowsRemoveFunction() override = default;

  ResponseAction Run() override {
    std::optional<windows::Remove::Params> params =
        windows::Remove::Params::Create(args());
    EXTENSION_FUNCTION_VALIDATE(params);
    DomicileWindowController* desk = DeskOf(*this);
    DomicileWindowController* window =
        desk == nullptr ? nullptr : desk->WindowWithId(params->window_id);
    if (window == nullptr) {
      return RespondNow(Error(WindowNotFound(params->window_id)));
    }
    if (!window->IsPopup()) {
      return RespondNow(Error(kNotOnADesk));
    }
    // Not awaited, as in tabs.remove: windows.onRemoved reports it.
    if (window->GetTabCount() == 0) {
      desk->ClosePopup(params->window_id);
    } else {
      for (int i = 0; i < window->GetTabCount(); ++i) {
        GuestOf(*window->GetWebContentsAt(i)).RequestClose();
      }
    }
    return RespondNow(NoArguments());
  }
};

}  // namespace

void RegisterDeskFunctions() {
  ExtensionFunctionRegistry& registry =
      ExtensionFunctionRegistry::GetInstance();
  registry.RegisterFunction<DeskTabsQueryFunction>();
  registry.RegisterFunction<DeskTabsUpdateFunction>();
  registry.RegisterFunction<DeskTabsCreateFunction>();
  registry.RegisterFunction<DeskTabsRemoveFunction>();
  registry.RegisterFunction<DeskTabsSetZoomFunction>();
  registry.RegisterFunction<DeskTabsGetZoomFunction>();
  registry.RegisterFunction<DeskTabsSetZoomSettingsFunction>();
  registry.RegisterFunction<DeskTabsGetZoomSettingsFunction>();
  registry.RegisterFunction<DeskWindowsGetFunction>();
  registry.RegisterFunction<DeskWindowsGetCurrentFunction>();
  registry.RegisterFunction<DeskWindowsGetLastFocusedFunction>();
  registry.RegisterFunction<DeskWindowsGetAllFunction>();
  registry.RegisterFunction<DeskWindowsUpdateFunction>();
  registry.RegisterFunction<DeskWindowsCreateFunction>();
  registry.RegisterFunction<DeskWindowsRemoveFunction>();
  // Histogram UNKNOWN, so refusals are not counted as the refused calls.
  for (const char* name : RefusedOnDesk()) {
    registry.Register(ExtensionFunctionRegistry::FactoryEntry(
        &NewExtensionFunction<DeskRefusalFunction>, name,
        extensions::functions::UNKNOWN));
  }
}

}  // namespace domicile
