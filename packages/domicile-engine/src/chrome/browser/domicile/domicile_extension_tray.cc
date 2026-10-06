// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_extension_tray.h"

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/scoped_multi_source_observation.h"
#include "base/scoped_observation.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/extensions/extension_action_dispatcher.h"
#include "components/domicile/browser/extension_tray_entry.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_icon_image.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/browser/permissions/active_tab_permission_granter.h"
#include "extensions/browser/ui_util.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_set.h"
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

// The tray for one shell document. A DocumentService, so a reloaded shell
// binds a new one.
//
// Resends the whole list when any of these fire:
//
//   ExtensionRegistryObserver   an extension loaded or unloaded
//   ExtensionActionDispatcher   an action's title, badge, popup, icon or
//                               enabled state changed
//   IconImage::Observer         a manifest icon finished loading; nothing
//                               else reports it
//   DeskObserver                the active tab changed, and action state is
//                               per tab
class ExtensionTray final
    : public content::DocumentService<mojom::ExtensionTray>,
      public extensions::ExtensionRegistryObserver,
      public extensions::ExtensionActionDispatcher::Observer,
      public extensions::IconImage::Observer,
      public DeskObserver {
 public:
  ExtensionTray(content::RenderFrameHost& frame,
                mojo::PendingReceiver<mojom::ExtensionTray> receiver)
      : DocumentService(frame, std::move(receiver)),
        context_(frame.GetBrowserContext()) {
    registry_observation_.Observe(
        extensions::ExtensionRegistry::Get(context_));
    dispatcher_observation_.Observe(
        extensions::ExtensionActionDispatcher::Get(context_));
    observing_desk_ = AddDeskObserver(context_, this);
  }

  ~ExtensionTray() override {
    if (observing_desk_) {
      RemoveDeskObserver(context_, this);
    }
  }

 private:
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

    // The click applies to the active tab: the <webview> last focused.
    content::WebContents* tab = ActiveDeskTab(context_);

    // Grant activeTab first, as ExtensionActionRunner::RunAction does, since
    // onClicked and the popup expect access already. With no desk tab, the
    // page is the shell, which gets no grant.
    if (tab != nullptr) {
      extensions::ActiveTabPermissionGranter* granter =
          extensions::ActiveTabPermissionGranter::FromWebContents(tab);
      // AttachTabHelpers gives every tab an extensions::TabHelper, which
      // creates the granter.
      CHECK(granter);
      granter->GrantIfRequested(extension);
      // guard-webview-active-tab.sh reads this line.
      if (granter->IsGranted(extension)) {
        LOG(INFO) << "domicile: the tray granted " << id
                  << " activeTab on tab " << TabIdOf(tab) << ".";
      }
    }

    // The shell opens popups, and Chrome sends no onClicked for an action
    // with a popup.
    if (action->HasPopup(TabIdOf(tab))) {
      LOG(INFO) << "domicile: the tray opened " << id << "'s popup.";
      return;
    }

    // `DispatchExtensionActionClicked` needs a WebContents, so without a desk
    // tab, pass the shell's page.
    LOG(INFO) << "domicile: the tray activated " << id << ".";
    extensions::ExtensionActionDispatcher::Get(context_)
        ->DispatchExtensionActionClicked(
            *action,
            tab != nullptr ? tab
                           : content::WebContents::FromRenderFrameHost(
                                 &render_frame_host()),
            extension);
  }

  // extensions::ExtensionRegistryObserver:
  void OnExtensionLoaded(content::BrowserContext* browser_context,
                         const Extension* extension) override {
    Send();
  }
  void OnExtensionUnloaded(content::BrowserContext* browser_context,
                           const Extension* extension,
                           extensions::UnloadedExtensionReason reason) override {
    Send();
  }

  // extensions::ExtensionActionDispatcher::Observer:
  //
  // The dispatcher is shared with the incognito profile; ignore its changes.
  void OnExtensionActionUpdated(
      ExtensionAction* extension_action,
      content::WebContents* web_contents,
      content::BrowserContext* browser_context) override {
    if (browser_context == context_) {
      Send();
    }
  }
  void OnShuttingDown() override { dispatcher_observation_.Reset(); }

  // DeskObserver:
  void OnActiveTabChanged() override { Send(); }

  // extensions::IconImage::Observer:
  void OnExtensionIconImageChanged(extensions::IconImage* image) override {
    Send();
  }
  void OnExtensionIconImageDestroyed(extensions::IconImage* image) override {
    icons_.RemoveObservation(image);
  }

  // Sends the whole list. Does nothing before SetClient, which sends it then.
  void Send() {
    if (!client_.is_bound()) {
      return;
    }

    // Read the scale on each send so icons follow the window across screens.
    content::RenderWidgetHostView* view = render_frame_host().GetView();
    const float scale = view == nullptr ? 1.0f : view->GetDeviceScaleFactor();

    // Show the active tab's state, as Chrome's toolbar does.
    const int tab = TabIdOf(ActiveDeskTab(context_));

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
      ExtensionAction* action = actions->GetExtensionAction(*extension);
      if (action == nullptr) {
        continue;
      }
      Watch(*action);
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
  base::ScopedMultiSourceObservation<extensions::IconImage,
                                     extensions::IconImage::Observer>
      icons_{this};
};

}  // namespace

void BindExtensionTray(content::RenderFrameHost* frame,
                       mojo::PendingReceiver<mojom::ExtensionTray> receiver) {
  // Self-owned; destroyed with the document.
  new ExtensionTray(*frame, std::move(receiver));
}

}  // namespace domicile
