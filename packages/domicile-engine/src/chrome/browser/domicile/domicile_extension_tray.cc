// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_extension_tray.h"

#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/memory/self_deleting.h"
#include "base/no_destructor.h"
#include "base/scoped_multi_source_observation.h"
#include "base/scoped_observation.h"
#include "base/strings/strcat.h"
#include "base/task/sequenced_task_runner.h"
#include "base/types/expected.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/domicile/domicile_extension_installer.h"
#include "chrome/browser/domicile/domicile_extension_settings.h"
#include "chrome/browser/extensions/extension_action_dispatcher.h"
#include "chrome/browser/profiles/profile.h"
#include "components/domicile/browser/command_protocol.h"
#include "components/domicile/browser/extension_settings.h"
#include "components/domicile/browser/extension_tray_entry.h"
#include "components/prefs/pref_change_registrar.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_icon_image.h"
#include "extensions/browser/extension_icon_placeholder.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_prefs_observer.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/permissions/active_tab_permission_granter.h"
#include "extensions/browser/ui_util.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/common/api/extension_action/action_info.h"
#include "extensions/common/constants.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_set.h"
#include "extensions/common/manifest_handlers/icons_handler.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using extensions::Extension;
using extensions::ExtensionAction;

// Encodes `image` at `scale` as a PNG data: URL, or nothing if it has no
// pixels at that scale yet.
std::optional<std::string> Encoded(const gfx::Image& image, float scale) {
  if (image.IsEmpty()) {
    return std::nullopt;
  }
  const gfx::ImageSkiaRep& rep = image.AsImageSkia().GetRepresentation(scale);
  if (rep.is_null()) {
    return std::nullopt;
  }
  std::optional<std::vector<uint8_t>> png = gfx::PNGCodec::EncodeBGRASkBitmap(
      rep.GetBitmap(), /*discard_transparency=*/false);
  if (!png.has_value()) {
    return std::nullopt;
  }
  return PngAsDataUrl(*png);
}

// Returns the icon the toolbar would draw for `tab`: the setIcon icon, else
// the manifest icon, else Chrome's placeholder. The placeholder is drawn
// synchronously, so it is never empty.
std::string IconOf(ExtensionAction& action, int tab, float scale) {
  const gfx::Image set = action.GetExplicitlySetIcon(tab);
  std::optional<std::string> icon =
      Encoded(set.IsEmpty() ? action.GetDefaultIconImage() : set, scale);
  if (!icon.has_value()) {
    icon = Encoded(action.GetPlaceholderIconImage(), scale);
  }
  CHECK(icon.has_value());
  return *std::move(icon);
}

// Returns the id an action stores `tab`'s state under, or the default id if
// there is no tab.
int TabIdOf(content::WebContents* tab) {
  return tab == nullptr ? ExtensionAction::kDefaultTabId
                        : sessions::SessionTabHelper::IdForTab(tab).id();
}

// Builds one tray entry with `tab`'s state. See TrayExtension in the mojom.
mojom::TrayExtensionPtr EntryFor(const Extension& extension,
                                 ExtensionAction& action,
                                 int tab,
                                 float scale) {
  const GURL popup = action.GetPopupUrl(tab);
  return mojom::TrayExtension::New(
      extension.id(), extension.name(), action.GetTitle(tab),
      IconOf(action, tab, scale), action.GetDisplayBadgeText(tab),
      BadgeColorAsCss(action.GetBadgeBackgroundColor(tab)),
      popup.is_empty() ? std::string() : popup.spec(),
      action.GetIsVisible(tab));
}

mojom::SiteAccess SiteAccessAsMojom(SiteAccess access) {
  switch (access) {
    case SiteAccess::kOnClick:
      return mojom::SiteAccess::kOnClick;
    case SiteAccess::kSpecificSites:
      return mojom::SiteAccess::kSpecificSites;
    case SiteAccess::kAllSites:
      return mojom::SiteAccess::kAllSites;
  }
}

SiteAccess SiteAccessFromMojom(mojom::SiteAccess access) {
  switch (access) {
    case mojom::SiteAccess::kOnClick:
      return SiteAccess::kOnClick;
    case mojom::SiteAccess::kSpecificSites:
      return SiteAccess::kSpecificSites;
    case mojom::SiteAccess::kAllSites:
      return SiteAccess::kAllSites;
  }
}

mojom::ExtensionSettingsPtr SettingsAsMojom(const ExtensionSettings& settings) {
  return mojom::ExtensionSettings::New(
      settings.in_private, settings.file_access, settings.user_scripts,
      settings.site_access.has_value()
          ? std::make_optional(SiteAccessAsMojom(*settings.site_access))
          : std::nullopt,
      settings.sites);
}

// `wanted` as ConfigureExtensionIn takes it, or why it is not a setting: a
// site that is not a host, or sites without kSpecificSites.
base::expected<ExtensionSettings, std::string> SettingsFromMojom(
    const mojom::ExtensionSettings& wanted) {
  ExtensionSettings settings;
  settings.in_private = wanted.in_private;
  settings.file_access = wanted.file_access;
  settings.user_scripts = wanted.user_scripts;
  if (wanted.site_access.has_value()) {
    settings.site_access = SiteAccessFromMojom(*wanted.site_access);
  }
  if (!wanted.sites.empty() &&
      settings.site_access != SiteAccess::kSpecificSites) {
    return base::unexpected("sites are only for specific sites' access");
  }
  for (const std::string& site : wanted.sites) {
    if (!SitePattern(site).has_value()) {
      return base::unexpected(base::StrCat({site, " is not a site"}));
    }
  }
  settings.sites = wanted.sites;
  return settings;
}

// An answer's error: empty for done.
std::string ErrorOf(const base::expected<void, std::string>& done) {
  return done.has_value() ? std::string() : done.error();
}

class ExtensionTray;

// Every live tray, for RequestExtensionPopup. Trays live on the UI thread.
std::set<ExtensionTray*>& Trays() {
  static base::NoDestructor<std::set<ExtensionTray*>> trays;
  return *trays;
}

// The tray for one shell document. A DocumentService, so a reloaded shell
// binds a new one.
//
// Resends the actions when any of these fire:
//
//   ExtensionRegistryObserver   an extension loaded or unloaded
//   ExtensionActionDispatcher   an action's title, badge, popup, icon or
//                               enabled state changed
//   IconImage::Observer         a manifest icon finished loading; nothing
//                               else reports it
//   DeskObserver                the active tab changed, and action state is
//                               per tab
//
// Resends the installed extensions, once per burst, when any of these fire:
//
//   ExtensionRegistryObserver   an extension installed, uninstalled, loaded
//                               or unloaded (switched on or off)
//   ExtensionPrefsObserver      a setting changed: user scripts and site
//                               access are prefs; private windows and file
//                               access reload the extension
//   IconImage::Observer         a manifest icon finished loading
//   PrefChangeRegistrar         the config's extensions or settings changed
class ExtensionTray final
    : public content::DocumentService<mojom::ExtensionTray>,
      public extensions::ExtensionRegistryObserver,
      public extensions::ExtensionPrefsObserver,
      public extensions::ExtensionActionDispatcher::Observer,
      public extensions::IconImage::Observer,
      public DeskObserver {
 public:
  ExtensionTray(content::RenderFrameHost& frame,
                mojo::PendingReceiver<mojom::ExtensionTray> receiver,
                base::SelfDeletingPassKey key)
      : DocumentService(frame, std::move(receiver), key),
        context_(frame.GetBrowserContext()) {
    registry_observation_.Observe(
        extensions::ExtensionRegistry::Get(context_));
    dispatcher_observation_.Observe(
        extensions::ExtensionActionDispatcher::Get(context_));
    prefs_observation_.Observe(extensions::ExtensionPrefs::Get(context_));
    config_.Init(profile().GetPrefs());
    WatchConfigExtensions(config_,
                          base::BindRepeating(&ExtensionTray::SendInstalledSoon,
                                              base::Unretained(this)));
    observing_desk_ = AddDeskObserver(context_, this);
    Trays().insert(this);
  }

  // Sends `popup` to this tray's client if it is `context`'s and has one.
  // Returns whether it was sent.
  bool RequestPopup(content::BrowserContext* context,
                    const std::string& id,
                    const GURL& popup) {
    if (context != context_ || !client_.is_bound()) {
      return false;
    }
    LOG(INFO) << "domicile: " << id << " asked the tray for its popup.";
    client_->PopupRequested(id, popup.spec());
    return true;
  }

 private:
  // Sends `action.onClicked` for extension `id` on `tab`. Called after the
  // grant, so either may be gone by then, as in
  // ExtensionActionRunner::DispatchExtensionActionClicked.
  void DispatchClicked(const std::string& id,
                       base::WeakPtr<content::WebContents> tab) {
    const Extension* extension = extensions::ExtensionRegistry::Get(context_)
                                     ->enabled_extensions()
                                     .GetByID(id);
    ExtensionAction* action =
        extension == nullptr
            ? nullptr
            : extensions::ExtensionActionManager::Get(context_)
                  ->GetExtensionAction(*extension);
    if (action == nullptr || !tab) {
      LOG(WARNING) << "domicile: the tray's click on " << id
                   << " outlived its extension or tab.";
      return;
    }
    LOG(INFO) << "domicile: the tray activated " << id << ".";
    extensions::ExtensionActionDispatcher::Get(context_)
        ->DispatchExtensionActionClicked(*action, tab.get(), extension);
  }

  ~ExtensionTray() override {
    Trays().erase(this);
    if (observing_desk_) {
      RemoveDeskObserver(context_, this);
    }
  }

  // mojom::ExtensionTray:
  void SetClient(
      mojo::PendingRemote<mojom::ExtensionTrayClient> client) override {
    if (client_.is_bound()) {
      ReportBadMessageAndDeleteThis(
          "domicile: the extension tray has one client per document.");
      return;
    }
    client_.Bind(std::move(client));
    Send();
    SendInstalled();
  }

  void Activate(const std::string& id) override {
    const Extension* extension = extensions::ExtensionRegistry::Get(context_)
                                     ->enabled_extensions()
                                     .GetByID(id);
    ExtensionAction* action =
        extension == nullptr
            ? nullptr
            : extensions::ExtensionActionManager::Get(context_)
                  ->GetExtensionAction(*extension);
    // The click raced an uninstall.
    if (action == nullptr) {
      LOG(WARNING) << "domicile: the tray activated " << id
                   << ", which has no action now.";
      return;
    }

    // The click applies to the active tab: the <webview> last focused, unless
    // that is a private page the extension is not allowed in.
    content::WebContents* tab = ActiveDeskTab(
        context_, extensions::util::IsIncognitoEnabled(extension, context_));

    // Chrome sends no onClicked for an action with a popup; the shell opens
    // the popup.
    const bool has_popup = action->HasPopup(TabIdOf(tab));
    if (has_popup) {
      LOG(INFO) << "domicile: the tray opened " << id << "'s popup.";
    }

    // With no desk tab, the page is the shell, which gets no grant.
    // `DispatchExtensionActionClicked` needs a WebContents, so pass the
    // shell's page.
    if (tab == nullptr) {
      if (!has_popup) {
        DispatchClicked(id, content::WebContents::FromRenderFrameHost(
                                &render_frame_host())
                                ->GetWeakPtr());
      }
      return;
    }

    // Grant activeTab first, as ExtensionActionRunner::RunAction does, and
    // dispatch onClicked once the grant reaches the network service, so the
    // listener can use it.
    extensions::ActiveTabPermissionGranter* granter =
        extensions::ActiveTabPermissionGranter::FromWebContents(tab);
    // AttachTabHelpers gives every tab an extensions::TabHelper, which
    // creates the granter.
    CHECK(granter);
    granter->GrantIfRequested(
        extension, has_popup ? base::DoNothing()
                             : base::BindOnce(&ExtensionTray::DispatchClicked,
                                              weak_factory_.GetWeakPtr(), id,
                                              tab->GetWeakPtr()));
    // guard-webview-active-tab.sh reads this line.
    if (granter->IsGranted(extension)) {
      LOG(INFO) << "domicile: the tray granted " << id << " activeTab on tab "
                << TabIdOf(tab) << ".";
    }
  }

  void SetEnabled(const std::string& id,
                  bool enabled,
                  SetEnabledCallback answer) override {
    LOG(INFO) << "domicile: the tray switches " << id
              << (enabled ? " on." : " off.");
    std::move(answer).Run(
        ErrorOf(SetExtensionEnabledIn(profile(), id, enabled)));
  }

  void Configure(const std::string& id,
                 mojom::ExtensionSettingsPtr wanted,
                 ConfigureCallback answer) override {
    std::move(answer).Run(Configured(id, *wanted));
  }

  void Uninstall(const std::string& id, UninstallCallback answer) override {
    LOG(INFO) << "domicile: the tray uninstalls " << id << ".";
    std::move(answer).Run(ErrorOf(UninstallFrom(profile(), id)));
  }

  // Sets `wanted` on extension `id`. Returns why not, or an empty string.
  std::string Configured(const std::string& id,
                         const mojom::ExtensionSettings& wanted) {
    const base::expected<ExtensionSettings, std::string> settings =
        SettingsFromMojom(wanted);
    if (!settings.has_value()) {
      return settings.error();
    }
    if (const std::optional<std::string> configured =
            SetByConfig(*settings, ConfiguredSettingsOf(profile(), id))) {
      return base::StrCat({"the desk's config sets ", *configured});
    }
    LOG(INFO) << "domicile: the tray configures " << id << ".";
    return ErrorOf(ConfigureExtensionIn(profile(), id, *settings));
  }

  // extensions::ExtensionRegistryObserver:
  void OnExtensionLoaded(content::BrowserContext* browser_context,
                         const Extension* extension) override {
    Send();
    SendInstalledSoon();
  }
  void OnExtensionUnloaded(content::BrowserContext* browser_context,
                           const Extension* extension,
                           extensions::UnloadedExtensionReason reason) override {
    Send();
    SendInstalledSoon();
  }
  // An update may bring a new icon, so its icon is loaded again.
  void OnExtensionInstalled(content::BrowserContext* browser_context,
                            const Extension* extension,
                            bool is_update) override {
    manifest_icons_.erase(extension->id());
    SendInstalledSoon();
  }
  void OnExtensionUninstalled(content::BrowserContext* browser_context,
                              const Extension* extension,
                              extensions::UninstallReason reason) override {
    manifest_icons_.erase(extension->id());
    SendInstalledSoon();
  }

  // extensions::ExtensionPrefsObserver:
  void OnExtensionPrefsUpdated(const std::string& extension_id) override {
    SendInstalledSoon();
  }
  void OnExtensionRuntimePermissionsChanged(
      const std::string& extension_id) override {
    SendInstalledSoon();
  }
  void OnExtensionWithholdingPermissionsChanged(
      const std::string& extension_id) override {
    SendInstalledSoon();
  }
  void OnExtensionPrefsWillBeDestroyed(
      extensions::ExtensionPrefs* prefs) override {
    prefs_observation_.Reset();
  }

  // extensions::ExtensionActionDispatcher::Observer:
  //
  // The dispatcher is shared with the incognito profile, whose changes are
  // private pages' state. Only another profile's are ignored.
  void OnExtensionActionUpdated(
      ExtensionAction* extension_action,
      content::WebContents* web_contents,
      content::BrowserContext* browser_context) override {
    if (browser_context == context_ ||
        Profile::FromBrowserContext(browser_context)->GetOriginalProfile() ==
            context_) {
      Send();
    }
  }
  void OnShuttingDown() override { dispatcher_observation_.Reset(); }

  // DeskObserver:
  void OnActiveTabChanged() override { Send(); }

  // extensions::IconImage::Observer:
  void OnExtensionIconImageChanged(extensions::IconImage* image) override {
    Send();
    SendInstalledSoon();
  }
  void OnExtensionIconImageDestroyed(extensions::IconImage* image) override {
    icons_.RemoveObservation(image);
  }

  Profile& profile() { return *Profile::FromBrowserContext(context_); }

  // The page's device scale factor, read on each send so icons follow the
  // window across screens.
  float Scale() {
    content::RenderWidgetHostView* view = render_frame_host().GetView();
    return view == nullptr ? 1.0f : view->GetDeviceScaleFactor();
  }

  // Sends the installed extensions once the current task ends, so a burst of
  // changes, such as a reload's unload, load and prefs, sends one list.
  void SendInstalledSoon() {
    if (installed_pending_) {
      return;
    }
    installed_pending_ = true;
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ExtensionTray::SendInstalled,
                                  weak_factory_.GetWeakPtr()));
  }

  // Sends every installed extension. Does nothing before SetClient, which
  // sends them then.
  void SendInstalled() {
    installed_pending_ = false;
    if (!client_.is_bound()) {
      return;
    }
    const float scale = Scale();
    const std::vector<std::string> from_config = ConfigExtensionsOf(profile());
    std::vector<mojom::InstalledExtensionPtr> installed;
    for (const InstalledExtension& extension : ExtensionsOf(profile())) {
      installed.push_back(mojom::InstalledExtension::New(
          extension.id, extension.name, ManifestIconOf(extension.id, scale),
          extension.enabled, SettingsAsMojom(extension.settings),
          SettingsAsMojom(ConfiguredSettingsOf(profile(), extension.id)),
          std::ranges::contains(from_config, extension.id),
          extension.options_url.is_empty() ? std::string()
                                           : extension.options_url.spec()));
    }
    client_->InstalledChanged(std::move(installed));
  }

  // Extension `id`'s manifest icon at `scale`, as chrome://extensions draws
  // it: Chrome's placeholder until it loads, which OnExtensionIconImageChanged
  // hears.
  std::string ManifestIconOf(const std::string& id, float scale) {
    auto found = manifest_icons_.find(id);
    if (found == manifest_icons_.end()) {
      const Extension* extension =
          extensions::ExtensionRegistry::Get(context_)->GetInstalledExtension(
              id);
      // ExtensionsOf listed it.
      CHECK(extension);
      auto icon = std::make_unique<extensions::IconImage>(
          context_, extension, extensions::IconsInfo::GetIcons(extension),
          extension_misc::EXTENSION_ICON_BITTY,
          extensions::ExtensionIconPlaceholder::CreateImage(
              extension_misc::EXTENSION_ICON_BITTY, extension->name())
              .AsImageSkia(),
          /*observer=*/nullptr);
      icons_.AddObservation(icon.get());
      found = manifest_icons_.emplace(id, std::move(icon)).first;
    }
    std::optional<std::string> icon = Encoded(found->second->image(), scale);
    // The placeholder is drawn synchronously, so it is never empty.
    CHECK(icon.has_value());
    return *std::move(icon);
  }

  // Sends the whole list. Does nothing before SetClient, which sends it then.
  void Send() {
    if (!client_.is_bound()) {
      return;
    }

    const float scale = Scale();

    extensions::ExtensionActionManager* actions =
        extensions::ExtensionActionManager::Get(context_);
    std::vector<mojom::TrayExtensionPtr> tray;
    for (const scoped_refptr<const Extension>& extension :
         extensions::ExtensionRegistry::Get(context_)->enabled_extensions()) {
      // Skip component extensions (such as the PDF viewer), as Chrome's
      // toolbar does.
      if (!extensions::ui_util::ShouldDisplayInExtensionSettings(*extension)) {
        continue;
      }
      // Skip an extension whose manifest names no action, such as the History
      // app. Chrome gives it a synthesized one that its toolbar shows only
      // once pinned, and the tray has no pins.
      ExtensionAction* action = actions->GetExtensionAction(*extension);
      if (action == nullptr ||
          extensions::ActionInfo::GetExtensionActionInfo(extension.get())
              ->synthesized) {
        continue;
      }
      Watch(*action);
      // Show the active tab's state, as Chrome's toolbar does.
      const int tab = TabIdOf(ActiveDeskTab(
          context_,
          extensions::util::IsIncognitoEnabled(extension.get(), context_)));
      tray.push_back(EntryFor(*extension, *action, tab, scale));
    }
    client_->ExtensionsChanged(std::move(tray));
  }

  // Observes `action`'s manifest icon, once per icon.
  void Watch(ExtensionAction& action) {
    extensions::IconImage* icon = action.default_icon_image();
    if (icon != nullptr && !icons_.IsObservingSource(icon)) {
      icons_.AddObservation(icon);
    }
  }

  // The shell's profile, shared by its <webview>s and the installer.
  const raw_ptr<content::BrowserContext> context_;

  mojo::Remote<mojom::ExtensionTrayClient> client_;

  // False if the profile has no desk; the tray then uses the default tab.
  bool observing_desk_ = false;

  base::ScopedObservation<extensions::ExtensionRegistry,
                          extensions::ExtensionRegistryObserver>
      registry_observation_{this};
  base::ScopedObservation<extensions::ExtensionActionDispatcher,
                          extensions::ExtensionActionDispatcher::Observer>
      dispatcher_observation_{this};
  base::ScopedObservation<extensions::ExtensionPrefs,
                          extensions::ExtensionPrefsObserver>
      prefs_observation_{this};
  base::ScopedMultiSourceObservation<extensions::IconImage,
                                     extensions::IconImage::Observer>
      icons_{this};

  // Every installed extension's manifest icon, by id. After `icons_`, so
  // each is destroyed while `icons_` can still stop observing it.
  std::map<std::string, std::unique_ptr<extensions::IconImage>> manifest_icons_;

  // The config's extensions and settings, which the installed list shows.
  PrefChangeRegistrar config_;

  // Whether SendInstalled is posted.
  bool installed_pending_ = false;

  base::WeakPtrFactory<ExtensionTray> weak_factory_{this};
};

}  // namespace

void BindExtensionTray(content::RenderFrameHost* frame,
                       mojo::PendingReceiver<mojom::ExtensionTray> receiver) {
  // Self-owned; destroyed with the document.
  base::MakeSelfDeleting<ExtensionTray>(*frame, std::move(receiver));
}

bool RequestExtensionPopup(content::BrowserContext* context,
                           const std::string& id,
                           const GURL& popup) {
  bool sent = false;
  for (ExtensionTray* tray : Trays()) {
    sent = tray->RequestPopup(context, id, popup) || sent;
  }
  return sent;
}

}  // namespace domicile
