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
#include "chrome/browser/extensions/extension_action_dispatcher.h"
#include "components/domicile/browser/extension_tray_entry.h"
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

// `image` at `scale`, as a PNG data: URL -- or nothing, for an image with no
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

// The icon the toolbar would draw for the default tab: one the extension set
// with action.setIcon, else the manifest's, else Chrome's placeholder -- the
// extension name's first letter, drawn synchronously, which is why it is the
// one that cannot come back empty.
std::string IconOf(ExtensionAction& action, float scale) {
  const gfx::Image set =
      action.GetExplicitlySetIcon(ExtensionAction::kDefaultTabId);
  std::optional<std::string> icon =
      Encoded(set.IsEmpty() ? action.GetDefaultIconImage() : set, scale);
  if (!icon.has_value()) {
    icon = Encoded(action.GetPlaceholderIconImage(), scale);
  }
  CHECK(icon.has_value());
  return *std::move(icon);
}

// One row of the tray, for the default tab. See TrayExtension in the mojom.
mojom::TrayExtensionPtr EntryFor(const Extension& extension,
                                 ExtensionAction& action,
                                 float scale) {
  const int tab = ExtensionAction::kDefaultTabId;
  const GURL popup = action.GetPopupUrl(tab);
  return mojom::TrayExtension::New(
      extension.id(), extension.name(), action.GetTitle(tab),
      IconOf(action, scale), action.GetDisplayBadgeText(tab),
      BadgeColorAsCss(action.GetBadgeBackgroundColor(tab)),
      popup.is_empty() ? std::string() : popup.spec(),
      action.GetIsVisible(tab));
}

// The tray, for one shell document.
//
// A DocumentService, like WebViewGuestHost: it goes with the document, so a
// shell that reloads binds a new one and is sent the list again.
//
// THREE THINGS SAY THE LIST MOVED, and every one of them resends all of it:
//
//   ExtensionRegistryObserver       an extension loaded or unloaded -- the
//                                   installer adding one the config named, or
//                                   removing one it stopped naming
//   ExtensionActionDispatcher       an action's state: a title, a badge, a
//                                   popup, an icon, enable() and disable()
//   IconImage::Observer             a manifest icon finished loading. Its first
//                                   image is Chrome's fallback, and nothing
//                                   else says when the real one arrives
class ExtensionTray final
    : public content::DocumentService<mojom::ExtensionTray>,
      public extensions::ExtensionRegistryObserver,
      public extensions::ExtensionActionDispatcher::Observer,
      public extensions::IconImage::Observer {
 public:
  ExtensionTray(content::RenderFrameHost& frame,
                mojo::PendingReceiver<mojom::ExtensionTray> receiver)
      : DocumentService(frame, std::move(receiver)),
        context_(frame.GetBrowserContext()) {
    registry_observation_.Observe(
        extensions::ExtensionRegistry::Get(context_));
    dispatcher_observation_.Observe(
        extensions::ExtensionActionDispatcher::Get(context_));
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
    // A click that raced an uninstall, not a page that lied: the id was in a
    // list this sent. Nothing to click.
    if (action == nullptr) {
      LOG(WARNING) << "domicile: the tray activated " << id
                   << ", which has no action now.";
      return;
    }

    // THE SHELL'S OWN PAGE IS THE TAB onClicked NAMES, until a <webview> can
    // be the active tab -- that is EXTENSIONS.md's slice 2, the window
    // controller. `DispatchExtensionActionClicked` builds a tab object out of
    // the WebContents it is handed, so it has to be handed one, and this is
    // the one that was clicked in.
    LOG(INFO) << "domicile: the tray activated " << id << ".";
    extensions::ExtensionActionDispatcher::Get(context_)
        ->DispatchExtensionActionClicked(
            *action, content::WebContents::FromRenderFrameHost(
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
  // The dispatcher is shared with the profile's incognito twin, so a change
  // there arrives here too, and is not this tray's.
  void OnExtensionActionUpdated(
      ExtensionAction* extension_action,
      content::WebContents* web_contents,
      content::BrowserContext* browser_context) override {
    if (browser_context == context_) {
      Send();
    }
  }
  void OnShuttingDown() override { dispatcher_observation_.Reset(); }

  // extensions::IconImage::Observer:
  void OnExtensionIconImageChanged(extensions::IconImage* image) override {
    Send();
  }
  void OnExtensionIconImageDestroyed(extensions::IconImage* image) override {
    icons_.RemoveObservation(image);
  }

  // The whole list, to the page. Nothing before the page has said where to:
  // SetClient sends it the moment it does.
  void Send() {
    if (!client_.is_bound()) {
      return;
    }

    // THE PAGE'S DENSITY, read now rather than when the tray was bound: a
    // shell window moved to a denser screen draws its icons at that screen's
    // scale from the next change on. A frame with no view yet is drawn nowhere
    // and gets 1.
    content::RenderWidgetHostView* view = render_frame_host().GetView();
    const float scale = view == nullptr ? 1.0f : view->GetDeviceScaleFactor();

    extensions::ExtensionActionManager* actions =
        extensions::ExtensionActionManager::Get(context_);
    std::vector<mojom::TrayExtensionPtr> tray;
    for (const scoped_refptr<const Extension>& extension :
         extensions::ExtensionRegistry::Get(context_)->enabled_extensions()) {
      // What chrome://extensions lists, which is Chrome's own rule for what
      // its toolbar offers: not the component extensions that are part of the
      // browser, like the PDF viewer.
      if (!extensions::ui_util::ShouldDisplayInExtensionSettings(*extension)) {
        continue;
      }
      ExtensionAction* action = actions->GetExtensionAction(*extension);
      if (action == nullptr) {
        continue;
      }
      Watch(*action);
      tray.push_back(EntryFor(*extension, *action, scale));
    }
    client_->ExtensionsChanged(std::move(tray));
  }

  // Hear when `action`'s manifest icon has loaded, once.
  void Watch(ExtensionAction& action) {
    extensions::IconImage* icon = action.default_icon_image();
    if (icon != nullptr && !icons_.IsObservingSource(icon)) {
      icons_.AddObservation(icon);
    }
  }

  // The shell's profile, which is the one its <webview>s browse in and the one
  // the installer puts extensions into.
  const raw_ptr<content::BrowserContext> context_;

  mojo::Remote<mojom::ExtensionTrayClient> client_;

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
  // Owns itself and goes with the document, as every DocumentService does.
  new ExtensionTray(*frame, std::move(receiver));
}

}  // namespace domicile
