// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/browser_plugin_guest_delegate.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "third_party/blink/public/common/tokens/tokens.h"
#include "url/gurl.h"

namespace domicile {

// The page behind a <webview>, and the fork's whole guest-view layer.
//
// It is one object wearing three of content's hats, the way
// components/guest_view's GuestViewBase does -- and deliberately NOT that
// class: this fork depends on neither //extensions nor //components/guest_view,
// and the four virtuals of BrowserPluginGuestDelegate are the entire cost of
// staying that way.
//
//   BrowserPluginGuestDelegate  makes the inner WebContents a *guest*, which
//                               is what gives it a WebContentsViewChildFrame
//                               and no platform window of its own
//   WebContentsDelegate         everything a page can ask of its embedder --
//                               new windows, dialogs, permissions. Refusals
//                               for now, opened one at a time against a guard
//   WebContentsObserver         the guest's lifetime, which after attaching is
//                               this object's own
//
// WHY A GUEST AND NOT A FRAME. A <webview> is a frame owner, so before this
// existed the page inside it was a subframe: X-Frame-Options and CSP
// frame-ancestors applied and most of the web refused to load. A guest's main
// frame is a main frame -- AncestorThrottle walks GetParentOrOuterDocument(),
// which by contract does not cross the boundary into an embedder -- so both
// checks pass, back and forward work across a process change, and storage is
// first-party rather than partitioned as a third party. `guard-webview-
// framing.sh` is the assertion that a site refusing framing loads in one.
//
// NOT AttachGuestPage/GuestPageHolder, which is the nicer API and is unusable
// here: web_contents_impl.cc CHECKs features::kGuestViewMPArch, which is
// FEATURE_DISABLED_BY_DEFAULT at our pin. AttachInnerWebContents is what
// shipping <webview> and PDF use today; the migration is upstream's to lead.
//
// NO GUEST SiteInstance, and that is a decision rather than an omission. A
// guest SiteInstance requires a non-default StoragePartition -- extensions'
// <webview> is isolated on purpose -- and a browser window in a separate
// partition is a browser window where the user is logged out of everything.
// The cost is that content CHECKs a guest's SiteInstance agrees with its
// WebContents in WebContentsImpl::CreateNewWindow, which is why
// IsWebContentsCreationOverridden below returns true unconditionally: refusing
// the window is what keeps that CHECK unreached.
class WebViewGuest : public mojom::WebViewGuest,
                     public content::BrowserPluginGuestDelegate,
                     public content::WebContentsDelegate,
                     public content::WebContentsObserver {
 public:
  // Create a guest for `placeholder`, a child frame of `owner`, and start
  // attaching it. `placeholder` is swapped out and destroyed by the attach.
  //
  // The guest exists from here on whether or not the attach completes: an
  // attach that is refused destroys it again, which is why this hands
  // ownership through the callback rather than keeping it anywhere.
  static void CreateAndAttach(
      content::RenderFrameHost& owner,
      content::RenderFrameHost& placeholder,
      mojo::PendingReceiver<mojom::WebViewGuest> receiver);

  WebViewGuest(const WebViewGuest&) = delete;
  WebViewGuest& operator=(const WebViewGuest&) = delete;

  ~WebViewGuest() override;

  // mojom::WebViewGuest:
  void Navigate(const GURL& url) override;

  // content::BrowserPluginGuestDelegate:
  content::WebContents* GetOwnerWebContents() override;
  content::RenderFrameHost* GetProspectiveOuterDocument() override;
  base::WeakPtr<content::BrowserPluginGuestDelegate> GetGuestDelegateWeakPtr()
      override;

  // content::WebContentsDelegate:
  //
  // WHERE A DESKTOP CHORD IS CAUGHT WHEN A BROWSER WINDOW HAS THE KEYBOARD,
  // and the reason there has to be somewhere. Both of the shell's own paths
  // die at once here: `<domicile-app>` is a portal element in the chrome's
  // document, so the shell sees every key a Wayland window is sent, but a
  // `<webview>` is a page of its own and `view.focus()` moves DOM focus into
  // it -- the shell's document is then told nothing, and neither is the
  // compositor, because the shell is what forwards keys to it. This runs for
  // the focused widget whichever frame owns it, which over a browser window is
  // the guest's, and it is the last layer above that page. On a match the key
  // is swallowed and the press goes back down the control channel; the
  // modifiers go every time, because a page that hears no keys hears no
  // modifier changes either and Alt is what a window is dragged with.
  //
  // A KEY NOBODY CLAIMED STOPS AT THE GUEST, which is measured rather than
  // assumed: `guard-webview-keyboard.sh` presses one before the window takes
  // the keyboard and one after, and the shell's document hears the first and
  // not the second. It is what content does with an unhandled key -- it comes
  // back to *this* WebContents' delegate in
  // WebContentsImpl::HandleKeyboardEvent, and there is no path from there into
  // the embedder's renderer. So this hook is not one of two ways a chord
  // reaches the shell over a browser window. It is the only one.
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      content::WebContents* source,
      const input::NativeWebKeyboardEvent& event) override;

  // A page in a browser window cannot open a second one yet. Overridden rather
  // than left to the default because the default is content creating the
  // window itself, and for a guest with no guest SiteInstance that path CHECKs
  // -- see the class comment. A refusal is the answer that has a guard behind
  // it; opening one is its own piece of work.
  bool IsWebContentsCreationOverridden(
      content::RenderFrameHost* opener,
      content::SiteInstance* source_site_instance,
      content::mojom::WindowContainerType window_container_type,
      const GURL& opener_url,
      const std::string& frame_name,
      const GURL& target_url) override;
  content::WebContents* CreateCustomWebContents(
      content::RenderFrameHost* opener,
      content::SiteInstance* source_site_instance,
      bool is_new_browsing_instance,
      const GURL& opener_url,
      const std::string& frame_name,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      const content::StoragePartitionConfig& partition_config,
      content::SessionStorageNamespace* session_storage_namespace) override;

  // content::WebContentsObserver:
  void WebContentsDestroyed() override;

 private:
  WebViewGuest(content::RenderFrameHost& owner,
               mojo::PendingReceiver<mojom::WebViewGuest> receiver);

  // The second half of CreateAndAttach, once content has produced a frame that
  // is safe to swap. `outer_contents_frame` is null when the frame went away
  // or a beforeunload handler under it said no, and dropping `guest` is then
  // the whole of the cleanup.
  static void Attach(std::unique_ptr<WebViewGuest> guest,
                     content::RenderFrameHost* outer_contents_frame);

  // Ours until Attach hands it to the outer WebContents, which is also the
  // moment this object stops being owned and starts owning itself.
  std::unique_ptr<content::WebContents> owned_guest_contents_;
  raw_ptr<content::WebContents> guest_contents_ = nullptr;

  // The <webview>'s document. An id rather than a pointer because a guest
  // outlives nothing and this must not be the reason it does.
  content::GlobalRenderFrameHostId owner_rfh_id_;

  // Set by Attach. Self-destruction in WebContentsDestroyed is only correct
  // once nobody else holds a unique_ptr to this.
  bool self_owned_ = false;

  mojo::Receiver<mojom::WebViewGuest> receiver_;

  base::WeakPtrFactory<WebViewGuest> weak_factory_{this};
};

// Bind WebViewGuestHost for `frame`: the interface a <webview> asks for a
// guest over.
//
// THIS IS NOT THE ACCESS CONTROL, for the same reason BindControlChannel is
// not. The caller decides who may reach it -- registering it only for a
// document whose origin is domicile:// -- and that decision is the whole of
// the security property. See PopulateChromeFrameBinders.
void BindWebViewGuestHost(
    content::RenderFrameHost* frame,
    mojo::PendingReceiver<mojom::WebViewGuestHost> receiver);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_GUEST_H_
