// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_window_controller.h"

#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ref.h"
#include "base/no_destructor.h"
#include "base/values.h"
#include "chrome/browser/extensions/api/tabs/tabs_constants.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/extensions/window_controller_list.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/extensions/api/tabs.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/event_router.h"
#include "extensions/browser/extension_event_histogram_value.h"
#include "extensions/common/constants.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using extensions::ExtensionTabUtil;

// What the desk is kept under on its profile.
constexpr char kDeskUserDataKey[] = "domicile_desk";

// chrome.tabs keys tabs_constants does not name. TabsEventRouter spells them
// the same way, locally, for the same reason.
constexpr char kMutedInfoKey[] = "mutedInfo";
constexpr char kTabIdKey[] = "tabId";

std::vector<DomicileWindowController*>& Live() {
  static base::NoDestructor<std::vector<DomicileWindowController*>> live;
  return *live;
}

// The tab `tab_id` in `context`'s desk, at the moment an event is delivered
// rather than when it was sent: a lazy listener wakes after the tab may have
// gone, and a tab that has gone is an event not delivered.
content::WebContents* TabAtDispatch(content::BrowserContext* context,
                                    int tab_id) {
  DomicileWindowController* desk = DomicileWindowController::Find(context);
  return desk == nullptr ? nullptr : desk->TabWithId(tab_id);
}

// tabs.onCreated's argument, scrubbed for each listener as TabsEventRouter's
// WillDispatchTabCreatedEvent does. `active` and `index` are right because
// CreateTabObject asks the desk -- see domicile_desk_hooks.h.
bool WillDispatchCreated(int tab_id,
                         content::BrowserContext* context,
                         extensions::mojom::ContextType target_context,
                         const extensions::Extension* extension,
                         const base::DictValue* listener_filter,
                         std::optional<base::ListValue>& event_args_out,
                         extensions::mojom::EventFilteringInfoPtr& filtering,
                         bool* dispatch_separate_event_out) {
  content::WebContents* tab = TabAtDispatch(context, tab_id);
  if (tab == nullptr) {
    return false;
  }
  event_args_out.emplace();
  event_args_out->Append(
      ExtensionTabUtil::CreateTabObject(
          tab,
          ExtensionTabUtil::GetScrubTabBehavior(extension, target_context, tab),
          extension)
          .ToValue());
  return true;
}

// tabs.onUpdated's three arguments, as WillDispatchTabUpdatedEvent builds them.
bool WillDispatchUpdated(int tab_id,
                         const std::set<std::string>& changed,
                         content::BrowserContext* context,
                         extensions::mojom::ContextType target_context,
                         const extensions::Extension* extension,
                         const base::DictValue* listener_filter,
                         std::optional<base::ListValue>& event_args_out,
                         extensions::mojom::EventFilteringInfoPtr& filtering,
                         bool* dispatch_separate_event_out) {
  content::WebContents* tab = TabAtDispatch(context, tab_id);
  if (tab == nullptr) {
    return false;
  }
  base::DictValue tab_value =
      ExtensionTabUtil::CreateTabObject(
          tab,
          ExtensionTabUtil::GetScrubTabBehavior(extension, target_context, tab),
          extension)
          .ToValue();
  base::DictValue changed_properties;
  for (const std::string& property : changed) {
    if (const base::Value* value = tab_value.Find(property)) {
      changed_properties.Set(property, value->Clone());
    }
  }
  event_args_out.emplace();
  event_args_out->Append(tab_id);
  event_args_out->Append(std::move(changed_properties));
  event_args_out->Append(std::move(tab_value));
  return true;
}

// Broadcast `event` in `profile`, as TabsEventRouter::DispatchEvent does: a
// profile shutting down has no router, and nobody to tell.
void Broadcast(Profile* profile, std::unique_ptr<extensions::Event> event) {
  if (extensions::EventRouter* router = extensions::EventRouter::Get(profile)) {
    event->user_gesture =
        extensions::EventRouter::UserGestureState::kNotEnabled;
    router->BroadcastEvent(std::move(event));
  }
}

}  // namespace

// One guest, heard as a tab: what TabsEventRouter::TabEntry hears of a tab in
// a strip, from the guest's own WebContents, plus the element taking focus.
class DomicileWindowController::Tab : public content::WebContentsObserver {
 public:
  Tab(DomicileWindowController& desk, content::WebContents& guest, int tab_id)
      : content::WebContentsObserver(&guest), desk_(desk), tab_id_(tab_id) {
    WebViewGuest* web_view = WebViewGuest::FromWebContents(&guest);
    CHECK(web_view);
    // Unretained: the subscription is a member, so it goes with this.
    focused_ = web_view->AddFocusedCallback(
        base::BindRepeating(&Tab::OnFocused, base::Unretained(this)));
  }

  // content::WebContentsObserver:
  void NavigationEntryCommitted(
      const content::LoadCommittedDetails& load_details) override {
    complete_waiting_on_load_ = true;
    desk_->Updated(tab_id_,
                   ChangedWithUrl(extensions::tabs_constants::kStatusKey));
  }

  // The first stop after a commit is `complete`; the ones a page's frames make
  // afterward are not news. TabEntry's rule.
  void DidStopLoading() override {
    if (complete_waiting_on_load_) {
      complete_waiting_on_load_ = false;
      desk_->Updated(tab_id_,
                     ChangedWithUrl(extensions::tabs_constants::kStatusKey));
    }
  }

  void TitleWasSet(content::NavigationEntry* entry) override {
    desk_->Updated(tab_id_, {extensions::tabs_constants::kTitleKey});
  }

  void DidUpdateAudioMutingState(bool muted) override {
    desk_->Updated(tab_id_, {kMutedInfoKey});
  }

  // Last, because it deletes this.
  void WebContentsDestroyed() override { desk_->Removed(tab_id_); }

 private:
  void OnFocused() { desk_->Focused(tab_id_, *web_contents()); }

  // `property`, and `url` too if the address moved since it was last said.
  std::set<std::string> ChangedWithUrl(const char* property) {
    std::set<std::string> changed = {property};
    if (web_contents()->GetURL() != url_) {
      url_ = web_contents()->GetURL();
      changed.insert(extensions::tabs_constants::kUrlKey);
    }
    return changed;
  }

  const raw_ref<DomicileWindowController> desk_;
  const int tab_id_;
  GURL url_;
  bool complete_waiting_on_load_ = false;
  base::CallbackListSubscription focused_;
};

// static
DomicileWindowController& DomicileWindowController::For(Profile* profile) {
  if (DomicileWindowController* desk = Find(profile)) {
    return *desk;
  }
  auto made = std::make_unique<DomicileWindowController>(profile);
  DomicileWindowController& desk = *made;
  profile->SetUserData(kDeskUserDataKey, std::move(made));
  return desk;
}

// static
DomicileWindowController* DomicileWindowController::Find(
    content::BrowserContext* context) {
  return context == nullptr ? nullptr
                            : static_cast<DomicileWindowController*>(
                                  context->GetUserData(kDeskUserDataKey));
}

// static
std::vector<DomicileWindowController*> DomicileWindowController::All() {
  return Live();
}

DomicileWindowController::DomicileWindowController(Profile* profile)
    : extensions::WindowController(&window_, profile),
      session_id_(SessionID::NewUnique()) {
  Live().push_back(this);
  extensions::WindowControllerList::GetInstance()->AddExtensionWindow(this);
}

DomicileWindowController::~DomicileWindowController() {
  extensions::WindowControllerList::GetInstance()->RemoveExtensionWindow(this);
  std::erase(Live(), this);
}

void DomicileWindowController::Add(content::WebContents& guest) {
  const int tab_id = ExtensionTabUtil::GetTabId(&guest);
  CHECK(SessionID::IsValidValue(tab_id));
  // The window this tab is in, which is what `windowId` on a tab object and
  // every event's `windowId` are read from.
  sessions::SessionTabHelper::FromWebContents(&guest)->SetWindowID(session_id_);

  const std::optional<int> before = tabs_.Active();
  tabs_.Add(tab_id);
  by_id_.emplace(tab_id, std::make_unique<Tab>(*this, guest, tab_id));

  auto event = std::make_unique<extensions::Event>(
      extensions::events::TABS_ON_CREATED,
      extensions::api::tabs::OnCreated::kEventName, base::ListValue(),
      profile());
  event->will_dispatch_callback =
      base::BindRepeating(&WillDispatchCreated, tab_id);
  Broadcast(profile(), std::move(event));

  ActiveMaybeChanged(before);

  if (!waiting_for_tab_.empty()) {
    base::OnceCallback<void(content::WebContents&)> gained =
        std::move(waiting_for_tab_.front());
    waiting_for_tab_.pop_front();
    std::move(gained).Run(guest);
  }
}

void DomicileWindowController::WhenNextTab(
    base::OnceCallback<void(content::WebContents&)> gained) {
  waiting_for_tab_.push_back(std::move(gained));
}

content::WebContents* DomicileWindowController::TabWithId(int tab_id) const {
  const auto found = by_id_.find(tab_id);
  return found == by_id_.end() ? nullptr : found->second->web_contents();
}

bool DomicileWindowController::Contains(content::WebContents& contents) const {
  return TabWithId(ExtensionTabUtil::GetTabId(&contents)) == &contents;
}

int DomicileWindowController::IndexOf(content::WebContents& tab) const {
  return tabs_.IndexOf(ExtensionTabUtil::GetTabId(&tab));
}

bool DomicileWindowController::IsActive(content::WebContents& tab) const {
  return tabs_.Active() == ExtensionTabUtil::GetTabId(&tab);
}

void DomicileWindowController::AddObserver(DeskObserver* observer) {
  observers_.AddObserver(observer);
}

void DomicileWindowController::RemoveObserver(DeskObserver* observer) {
  observers_.RemoveObserver(observer);
}

int DomicileWindowController::GetWindowId() const {
  return session_id_.id();
}

std::string DomicileWindowController::GetWindowTypeText() const {
  return extensions::api::tabs::ToString(
      extensions::api::tabs::WindowType::kNormal);
}

// The desk is the whole screen already, and the shell's to change.
void DomicileWindowController::SetFullscreenMode(
    bool is_fullscreen,
    const GURL& extension_url) const {}

content::WebContents* DomicileWindowController::GetActiveTab() const {
  const std::optional<int> active = tabs_.Active();
  return active.has_value() ? TabWithId(*active) : nullptr;
}

int DomicileWindowController::GetTabCount() const {
  return static_cast<int>(tabs_.InCreationOrder().size());
}

content::WebContents* DomicileWindowController::GetWebContentsAt(int i) const {
  const std::vector<int>& order = tabs_.InCreationOrder();
  return i < 0 || static_cast<size_t>(i) >= order.size()
             ? nullptr
             : TabWithId(order[static_cast<size_t>(i)]);
}

bool DomicileWindowController::IsVisibleToTabsAPIForExtension(
    const extensions::Extension* extension,
    bool include_dev_tools_windows) const {
  return true;
}

base::DictValue DomicileWindowController::CreateWindowValueForExtension(
    const extensions::Extension* extension,
    PopulateTabBehavior populate_tab_behavior,
    extensions::mojom::ContextType context) const {
  // What BrowserExtensionWindowController says, less the bounds: the desk's
  // are the shell's screens, and a window is not a rectangle this process
  // knows. The schema leaves them optional.
  base::DictValue window;
  window.Set(extension_misc::kId, GetWindowId());
  window.Set("type", GetWindowTypeText());
  window.Set("focused", true);
  window.Set("incognito", profile()->IsOffTheRecord());
  window.Set("alwaysOnTop", false);
  window.Set("state", "normal");
  if (populate_tab_behavior == kPopulateTabs) {
    window.Set(ExtensionTabUtil::kTabsKey, CreateTabList(extension, context));
  }
  return window;
}

base::ListValue DomicileWindowController::CreateTabList(
    const extensions::Extension* extension,
    extensions::mojom::ContextType context) const {
  base::ListValue list;
  for (int tab_id : tabs_.InCreationOrder()) {
    content::WebContents* tab = TabWithId(tab_id);
    list.Append(
        ExtensionTabUtil::CreateTabObject(
            tab, ExtensionTabUtil::GetScrubTabBehavior(extension, context, tab),
            extension)
            .ToValue());
  }
  return list;
}

// A second browser window at the options page, asked of the shell through the
// active tab's element -- the way a page's `target="_blank"` asks. False with
// no tab to ask through: nothing opened it.
bool DomicileWindowController::OpenOptionsPage(
    const extensions::Extension* extension,
    const GURL& url,
    bool open_in_tab) {
  content::WebContents* active = GetActiveTab();
  if (active == nullptr) {
    return false;
  }
  WebViewGuest::FromWebContents(active)->RequestWindow(url);
  return true;
}

void DomicileWindowController::Focused(int tab_id, content::WebContents& tab) {
  if (TakesActiveOnFocus(tab.GetLastCommittedURL().scheme())) {
    const std::optional<int> before = tabs_.Active();
    tabs_.Focus(tab_id);
    ActiveMaybeChanged(before);
  }
}

void DomicileWindowController::Updated(int tab_id,
                                       std::set<std::string> changed) {
  auto event = std::make_unique<extensions::Event>(
      extensions::events::TABS_ON_UPDATED,
      extensions::api::tabs::OnUpdated::kEventName, base::ListValue(),
      profile());
  event->will_dispatch_callback =
      base::BindRepeating(&WillDispatchUpdated, tab_id, std::move(changed));
  Broadcast(profile(), std::move(event));
}

void DomicileWindowController::Removed(int tab_id) {
  const std::optional<int> before = tabs_.Active();
  tabs_.Remove(tab_id);
  by_id_.erase(tab_id);

  base::DictValue info;
  info.Set(extensions::tabs_constants::kWindowIdKey, GetWindowId());
  info.Set(extensions::tabs_constants::kIsWindowClosingKey, false);
  base::ListValue args;
  args.Append(tab_id);
  args.Append(std::move(info));
  Broadcast(profile(), std::make_unique<extensions::Event>(
                           extensions::events::TABS_ON_REMOVED,
                           extensions::api::tabs::OnRemoved::kEventName,
                           std::move(args), profile()));

  ActiveMaybeChanged(before);
}

void DomicileWindowController::ActiveMaybeChanged(std::optional<int> before) {
  const std::optional<int> after = tabs_.Active();
  if (after == before) {
    return;
  }
  if (after.has_value()) {
    base::DictValue info;
    info.Set(kTabIdKey, *after);
    info.Set(extensions::tabs_constants::kWindowIdKey, GetWindowId());
    base::ListValue args;
    args.Append(std::move(info));
    Broadcast(profile(), std::make_unique<extensions::Event>(
                             extensions::events::TABS_ON_ACTIVATED,
                             extensions::api::tabs::OnActivated::kEventName,
                             std::move(args), profile()));
  }
  for (DeskObserver& observer : observers_) {
    observer.OnActiveTabChanged();
  }
}

bool DeskWindow::IsActive() const {
  return true;
}
bool DeskWindow::IsMaximized() const {
  return false;
}
bool DeskWindow::IsMinimized() const {
  return false;
}
bool DeskWindow::IsFullscreen() const {
  return false;
}
gfx::NativeWindow DeskWindow::GetNativeWindow() const {
  return gfx::NativeWindow();
}
gfx::Rect DeskWindow::GetRestoredBounds() const {
  return gfx::Rect();
}
ui::mojom::WindowShowState DeskWindow::GetRestoredState() const {
  return ui::mojom::WindowShowState::kNormal;
}
gfx::Rect DeskWindow::GetBounds() const {
  return gfx::Rect();
}
void DeskWindow::Show() {}
void DeskWindow::Hide() {}
bool DeskWindow::IsVisible() const {
  return true;
}
void DeskWindow::ShowInactive() {}
void DeskWindow::Close() {}
void DeskWindow::Activate() {}
void DeskWindow::Deactivate() {}
void DeskWindow::Maximize() {}
void DeskWindow::Minimize() {}
void DeskWindow::Restore() {}
void DeskWindow::SetBounds(const gfx::Rect& bounds) {}
void DeskWindow::FlashFrame(bool flash) {}
ui::ZOrderLevel DeskWindow::GetZOrderLevel() const {
  return ui::ZOrderLevel::kNormal;
}
void DeskWindow::SetZOrderLevel(ui::ZOrderLevel order) {}

}  // namespace domicile
