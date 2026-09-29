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
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_function.h"
#include "extensions/browser/extension_function_registry.h"
#include "extensions/common/error_utils.h"
#include "extensions/common/url_pattern.h"
#include "extensions/common/url_pattern_set.h"
#include "url/gurl.h"

namespace domicile {
namespace {

namespace tabs = extensions::api::tabs;
namespace windows = extensions::api::windows;
using extensions::ExtensionTabUtil;

// Chrome's spelling, so an extension that matches on it still does.
constexpr char kTabNotFoundError[] = "No tab with id: *.";

// What tabs.create and windows.update ask through when there is nothing to ask
// through: a desk with no browser window at all.
constexpr char kNoWindowToAskError[] =
    "No browser window on this Domicile desk to ask the shell through.";

// The desk of the profile `function` was called from, or null where there is
// none.
DomicileWindowController* DeskOf(ExtensionFunction& function) {
  return DomicileWindowController::Find(function.browser_context());
}

WebViewGuest& GuestOf(content::WebContents& tab) {
  WebViewGuest* guest = WebViewGuest::FromWebContents(&tab);
  CHECK(guest);
  return *guest;
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

// queryInfo as //components/domicile:desk_tabs reads it.
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

// A desk tab as much as a query compares.
DeskTabFacts FactsOf(DomicileWindowController& desk,
                     content::WebContents& tab) {
  return DeskTabFacts{.active = desk.IsActive(tab),
                      .index = desk.IndexOf(tab),
                      .window_id = desk.GetWindowId(),
                      .audible = tab.IsCurrentlyAudible(),
                      .muted = tab.IsAudioMuted(),
                      .status = std::string(tabs::ToString(
                          ExtensionTabUtil::GetLoadingStatus(&tab)))};
}

// `title` and `url`, which are privileged: a tab whose data the extension may
// not see matches neither. TabsQueryFunction::MatchesTab's rule.
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

// Every name in RefusedOnDesk(), answered with kNotOnADesk.
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

    // SCHEME_ALL, as Chrome's: a query sees URLs and grants no access to them.
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
    for (int i = 0; desk != nullptr && i < desk->GetTabCount(); ++i) {
      content::WebContents& tab = *desk->GetWebContentsAt(i);
      if (DeskTabMatches(query, FactsOf(*desk, tab)) &&
          MatchesPrivileged(*this, info, url_patterns, tab)) {
        result.Append(TabValue(*this, tab));
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

    // What a desk tab has no meaning for, refused before anything is done so
    // that no update is half made.
    if (update.pinned.value_or(false) || update.opener_tab_id ||
        update.auto_discardable) {
      return RespondNow(Error(kNotOnADesk));
    }

    content::WebContents* tab = TabToUpdate(params->tab_id);
    if (tab == nullptr) {
      return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
          kTabNotFoundError,
          base::NumberToString(params->tab_id.value_or(-1)))));
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
    // In front is the shell's to decide. It is asked, and the tab this answers
    // with is as it is now: active once the shell has focused it.
    if (update.active.value_or(false) || update.highlighted.value_or(false) ||
        update.selected.value_or(false)) {
      GuestOf(*tab).RequestFocus();
    }
    return RespondNow(WithArguments(TabValue(*this, *tab)));
  }

  // The tab named, or with no id the active one, as Chrome's default is the
  // current window's active tab.
  content::WebContents* TabToUpdate(std::optional<int> tab_id) {
    DomicileWindowController* desk = DeskOf(*this);
    if (desk == nullptr) {
      return nullptr;
    }
    return tab_id ? desk->TabWithId(*tab_id) : desk->GetActiveTab();
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

    // Where the window goes, and whether it is pinned, split or opened by
    // another, are the shell's -- and a window with no address is not one the
    // shell has anywhere to point.
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
    // The tab is the shell's to make, and the next one the desk gains is it.
    // Retained: this function lives until the shell has made the tab.
    desk->WhenNextTab(base::BindOnce(&DeskTabsCreateFunction::Created,
                                     base::WrapRefCounted(this)));
    GuestOf(*asker).RequestWindow(*url);
    return RespondLater();
  }

  void Created(content::WebContents& tab) {
    Respond(WithArguments(TabValue(*this, tab)));
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

    // Every id found before any is asked to close, so that one bad id closes
    // nothing.
    DomicileWindowController* desk = DeskOf(*this);
    std::vector<content::WebContents*> found;
    for (int id : ids) {
      content::WebContents* tab =
          desk == nullptr ? nullptr : desk->TabWithId(id);
      if (tab == nullptr) {
        return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
            kTabNotFoundError, base::NumberToString(id))));
      }
      found.push_back(tab);
    }
    // Asked, not waited for: closing is removing the element, and whether the
    // shell does is its own. tabs.onRemoved says when it has.
    for (content::WebContents* tab : found) {
      GuestOf(*tab).RequestClose();
    }
    return RespondNow(NoArguments());
  }
};

// The four chrome.windows reads. The desk is the one window, so every one of
// them answers with it -- `get` only by its own id.
class DeskWindowReadFunction : public ExtensionFunction {
 protected:
  ~DeskWindowReadFunction() override = default;

  ResponseAction RespondWithDesk(
      const std::optional<windows::QueryOptions>& options) {
    DomicileWindowController* desk = DeskOf(*this);
    if (desk == nullptr) {
      return RespondNow(Error(ExtensionTabUtil::kNoCurrentWindowError));
    }
    return RespondNow(WithArguments(DeskValue(*desk, options)));
  }

  base::DictValue DeskValue(
      DomicileWindowController& desk,
      const std::optional<windows::QueryOptions>& options) {
    return desk.CreateWindowValueForExtension(
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
    DomicileWindowController* desk = DeskOf(*this);
    if (desk == nullptr || (params->window_id != kCurrentWindowId &&
                            params->window_id != desk->GetWindowId())) {
      return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
          ExtensionTabUtil::kWindowNotFoundError,
          base::NumberToString(params->window_id))));
    }
    return RespondWithDesk(params->query_options);
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
    return RespondWithDesk(params->query_options);
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
    return RespondWithDesk(params->query_options);
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
    base::ListValue all;
    if (DomicileWindowController* desk = DeskOf(*this)) {
      all.Append(DeskValue(*desk, params->query_options));
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

    // Bounds, state and attention are the shell's; only "in front" is a
    // question it can be asked.
    if (update.left || update.top || update.width || update.height ||
        update.draw_attention || update.state != windows::WindowState::kNone ||
        !update.focused.value_or(true)) {
      return RespondNow(Error(kNotOnADesk));
    }
    DomicileWindowController* desk = DeskOf(*this);
    if (desk == nullptr || (params->window_id != kCurrentWindowId &&
                            params->window_id != desk->GetWindowId())) {
      return RespondNow(Error(extensions::ErrorUtils::FormatErrorMessage(
          ExtensionTabUtil::kWindowNotFoundError,
          base::NumberToString(params->window_id))));
    }
    if (update.focused.value_or(false)) {
      content::WebContents* active = desk->GetActiveTab();
      if (active == nullptr) {
        return RespondNow(Error(kNoWindowToAskError));
      }
      GuestOf(*active).RequestFocus();
    }
    return RespondNow(WithArguments(DeskValue(*desk, std::nullopt)));
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
  registry.RegisterFunction<DeskWindowsGetFunction>();
  registry.RegisterFunction<DeskWindowsGetCurrentFunction>();
  registry.RegisterFunction<DeskWindowsGetLastFocusedFunction>();
  registry.RegisterFunction<DeskWindowsGetAllFunction>();
  registry.RegisterFunction<DeskWindowsUpdateFunction>();
  // Histogram UNKNOWN: a refusal is not the call it refused.
  for (const char* name : RefusedOnDesk()) {
    registry.Register(ExtensionFunctionRegistry::FactoryEntry(
        &NewExtensionFunction<DeskRefusalFunction>, name,
        extensions::functions::UNKNOWN));
  }
}

}  // namespace domicile
