// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/web_view_guest.h"

#include <memory>
#include <string>
#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/ptr_util.h"
#include "components/domicile/browser/shortcut_registry.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_process_host.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "ui/base/page_transition_types.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/keycode_converter.h"

namespace domicile {
namespace {

// The interface a <webview> asks for a guest over, for one document.
//
// A DocumentService rather than a self-owned receiver, because everything it
// does is relative to the document that asked: the frame it is handed has to be
// that document's own child, and a document that navigates away has no claim on
// the guests the previous one made.
class WebViewGuestHost final
    : public content::DocumentService<mojom::WebViewGuestHost> {
 public:
  WebViewGuestHost(content::RenderFrameHost& frame,
                   mojo::PendingReceiver<mojom::WebViewGuestHost> receiver)
      : DocumentService(frame, std::move(receiver)) {}

 private:
  // mojom::WebViewGuestHost:
  void CreateGuest(
      const blink::LocalFrameToken& placeholder_frame,
      mojo::PendingReceiver<mojom::WebViewGuest> guest) override {
    // Same process as the asking document, always: the placeholder is the
    // frame the owner element created and never navigated, so it is still the
    // local about:blank frame its parent made.
    content::RenderFrameHost* placeholder =
        content::RenderFrameHost::FromFrameToken(
            content::GlobalRenderFrameHostToken(
                render_frame_host().GetProcess()->GetID(), placeholder_frame));

    // Gone between the element sending this and the browser reading it -- the
    // <webview> was removed from the document. A race, not a lie, so the pipe
    // is dropped and the element's remote learns it: killing the shell over
    // its own timing would be the fork's bug and not the shell's.
    if (placeholder == nullptr) {
      LOG(WARNING) << "domicile: the frame a <webview> asked a guest for is "
                      "already gone.";
      return;
    }

    // A lie, though, and the only one available here: a document claiming a
    // guest for a frame that is not its own child could put a page it does not
    // own inside somebody else's element.
    //
    // DocumentService's own version rather than mojo::ReportBadMessage, which
    // its header asks for: it resets the receiver before deleting, so a reply
    // callback does not have to be run with made-up arguments first.
    if (placeholder->GetParent() != &render_frame_host()) {
      ReportBadMessageAndDeleteThis(
          "domicile: a <webview> may only ask for a guest for its own frame.");
      return;
    }

    WebViewGuest::CreateAndAttach(render_frame_host(), *placeholder,
                                  std::move(guest));
  }
};

}  // namespace

// static
void WebViewGuest::CreateAndAttach(
    content::RenderFrameHost& owner,
    content::RenderFrameHost& placeholder,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver) {
  std::unique_ptr<WebViewGuest> guest =
      base::WrapUnique(new WebViewGuest(owner, std::move(receiver)));

  // `guest_delegate` is what makes the new WebContents a guest, and content
  // asks it for its owner while constructing -- which is why the delegate is
  // built first and knows its owner from its constructor.
  //
  // No SiteInstance and no StoragePartitionConfig: the guest belongs in the
  // default partition, where the user's cookies are. See the class comment.
  content::WebContents::CreateParams params(owner.GetBrowserContext());
  params.guest_delegate = guest.get();
  std::unique_ptr<content::WebContents> contents =
      content::WebContents::Create(params);

  guest->guest_contents_ = contents.get();
  guest->owned_guest_contents_ = std::move(contents);
  guest->Observe(guest->guest_contents_);
  guest->guest_contents_->SetDelegate(guest.get());

  // Asynchronous, and the API says why: the placeholder is about to be swapped
  // out, so every beforeunload handler under it has to answer first, and a
  // cross-process placeholder has to be replaced by a same-process one. What
  // comes back is the frame that is safe to swap, which may not be the frame
  // handed in.
  placeholder.PrepareForInnerWebContentsAttach(
      base::BindOnce(&WebViewGuest::Attach, std::move(guest)));
}

// static
void WebViewGuest::Attach(std::unique_ptr<WebViewGuest> guest,
                          content::RenderFrameHost* outer_contents_frame) {
  // Null is a refusal: a beforeunload handler kept the frame, or the frame was
  // detached while this was in flight. Returning destroys `guest`, and with it
  // the WebContents it still owns.
  if (outer_contents_frame == nullptr) {
    return;
  }

  // The frame's own WebContents rather than the owner this was built with:
  // AttachInnerWebContents CHECKs that they are the same, and a shell that
  // navigated while the attach was in flight has a new document -- and so a new
  // RenderFrameHost -- behind the id this object holds.
  content::WebContents* owner =
      content::WebContents::FromRenderFrameHost(outer_contents_frame);
  CHECK(owner);

  std::unique_ptr<content::WebContents> contents =
      std::move(guest->owned_guest_contents_);

  // From here the guest is scoped to the guest page's lifetime, exactly as
  // GuestViewBase does it: the outer WebContents takes the inner one, and this
  // object self-destructs in WebContentsDestroyed.
  guest->self_owned_ = true;
  guest.release();

  // `is_full_page` is false, and it is not a detail. It means "give the inner
  // WebContents focus", and it CHECKs that the outer WebContents has exactly
  // one inner one -- which a shell with two browser windows open does not.
  // Focus is the shell's to move -- `BrowserWindow.tsx` calls `view.focus()`
  // when a browser window becomes the one the user is working in -- and this
  // flag is not how.
  owner->AttachInnerWebContents(std::move(contents), outer_contents_frame,
                                /*is_full_page=*/false);

  // The one line that says the guest exists, and it earns its place: a
  // <webview> showing nothing has four possible causes and only this tells
  // three of them from the fourth. `domicile:` is the prefix
  // engine-diagnostics.sh greps the browser's log for.
  LOG(INFO) << "domicile: attached a guest to a <webview>.";
}

WebViewGuest::WebViewGuest(content::RenderFrameHost& owner,
                           mojo::PendingReceiver<mojom::WebViewGuest> receiver)
    : owner_rfh_id_(owner.GetGlobalId()),
      receiver_(this, std::move(receiver)) {}

WebViewGuest::~WebViewGuest() = default;

void WebViewGuest::Navigate(const GURL& url) {
  // A CHECK rather than a guard: this object is destroyed with the guest's
  // WebContents, so there is no moment at which the pipe is open and the
  // WebContents is gone.
  //
  // Before the attach as well as after, and that is why the element needs no
  // callback to wait on: a guest still waiting for its placeholder navigates
  // all the same, because content brings the browser side of a guest up during
  // the attach whether or not it has been anywhere.
  CHECK(guest_contents_);

  // NOT VALIDATED HERE, and that is deliberate rather than missed. The only
  // document that can reach this is the shell's, and the shell can already ask
  // the compositor to run a command on the machine; a scheme allowlist in
  // front of a page that holds `Spawn` would protect nothing. What keeps this
  // safe is the binder, and it is the same one ControlChannel has.
  content::NavigationController::LoadURLParams params(url);
  params.transition_type = ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
  guest_contents_->GetController().LoadURLWithParams(params);
}

void WebViewGuest::GoBack() {
  // The same CHECK Navigate makes, and for the same reason: this object is
  // destroyed with the guest's WebContents, so there is no moment at which the
  // pipe is open and the WebContents is gone.
  CHECK(guest_contents_);

  // NOT GUARDED WITH CanGoBack(), which would be a guard on a condition the
  // callee already answers: GoBack returns without navigating when there is
  // nowhere to go. An address bar whose buttons cannot yet be greyed out
  // presses this with an empty history as a matter of course, so a back with
  // nowhere to go is the ordinary case rather than a bad message.
  guest_contents_->GetController().GoBack();
}

void WebViewGuest::GoForward() {
  CHECK(guest_contents_);
  guest_contents_->GetController().GoForward();
}

void WebViewGuest::Stop() {
  CHECK(guest_contents_);
  // The WebContents rather than its controller, which has no Stop: a pending
  // navigation is the WebContents', and cancelling it is what an address bar's
  // stop button means.
  guest_contents_->Stop();
}

void WebViewGuest::Reload() {
  CHECK(guest_contents_);
  // `check_for_repost` true, which is what a browser passes in production. It
  // reaches this delegate's ShowRepostFormWarningDialog, which is content's
  // do-nothing default -- so reloading a POST result currently does nothing
  // rather than silently reposting. That is the guest's "refuses everything an
  // embedder is asked for" gap, and reposting without asking would be the
  // worse half of it to close by accident.
  guest_contents_->GetController().Reload(content::ReloadType::NORMAL,
                                          /*check_for_repost=*/true);
}

content::WebContents* WebViewGuest::GetOwnerWebContents() {
  content::RenderFrameHost* owner =
      content::RenderFrameHost::FromID(owner_rfh_id_);
  return owner ? content::WebContents::FromRenderFrameHost(owner) : nullptr;
}

content::RenderFrameHost* WebViewGuest::GetProspectiveOuterDocument() {
  return content::RenderFrameHost::FromID(owner_rfh_id_);
}

base::WeakPtr<content::BrowserPluginGuestDelegate>
WebViewGuest::GetGuestDelegateWeakPtr() {
  return weak_factory_.GetWeakPtr();
}

content::KeyboardEventProcessingResult WebViewGuest::PreHandleKeyboardEvent(
    content::WebContents* source,
    const input::NativeWebKeyboardEvent& event) {
  const int modifiers = event.GetModifiers();
  const Modifiers held{
      (modifiers & blink::WebInputEvent::kAltKey) != 0,
      (modifiers & blink::WebInputEvent::kControlKey) != 0,
      (modifiers & blink::WebInputEvent::kShiftKey) != 0,
      (modifiers & blink::WebInputEvent::kMetaKey) != 0,
  };

  // EVERY EVENT, including the releases and the ones no chord matches. A
  // modifier is a state the shell holds rather than a keystroke it answers --
  // Alt hands the pointer back to the page, Shift makes the drag a resize --
  // and the registry drops the ones that changed nothing, so this is a compare
  // and not a message. Doing it before the match, so that a chord's own Alt is
  // reported rather than swallowed with the key.
  ShortcutRegistry::Get().SetModifiers(held);

  // Presses only, which is what the control protocol carries: a release
  // changes nothing and would arrive as a second event for one keystroke.
  //
  // And not an auto-repeat, which is the page's own reading of the same rule --
  // a held key repeats tens of times a second and only the first of them acts.
  const bool pressed =
      event.GetType() == blink::WebInputEvent::Type::kRawKeyDown ||
      event.GetType() == blink::WebInputEvent::Type::kKeyDown;
  if (!pressed || (modifiers & blink::WebInputEvent::kIsAutoRepeat) != 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // Evdev, because that is the numbering the control protocol speaks and the
  // one the shell claimed its chords in. Zero is a key with no evdev code at
  // all, which no claim can name.
  const int evdev = ui::KeycodeConverter::DomCodeToEvdevCode(
      static_cast<ui::DomCode>(event.dom_code));
  if (evdev == 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // HANDLED rather than NOT_HANDLED, and that is the half that makes a claim a
  // claim: the guest's page never sees the key, so a site that binds Alt+Tab
  // for itself cannot take the desktop's chord away from the user.
  return ShortcutRegistry::Get().Press(
             Chord{static_cast<uint32_t>(evdev), held.alt, held.ctrl,
                   held.shift, held.meta})
             ? content::KeyboardEventProcessingResult::HANDLED
             : content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool WebViewGuest::IsWebContentsCreationOverridden(
    content::RenderFrameHost* opener,
    content::SiteInstance* source_site_instance,
    content::mojom::WindowContainerType window_container_type,
    const GURL& opener_url,
    const std::string& frame_name,
    const GURL& target_url) {
  return true;
}

content::WebContents* WebViewGuest::CreateCustomWebContents(
    content::RenderFrameHost* opener,
    content::SiteInstance* source_site_instance,
    bool is_new_browsing_instance,
    const GURL& opener_url,
    const std::string& frame_name,
    const GURL& target_url,
    WindowOpenDisposition disposition,
    const blink::mojom::WindowFeatures& window_features,
    const content::StoragePartitionConfig& partition_config,
    content::SessionStorageNamespace* session_storage_namespace) {
  LOG(WARNING) << "domicile: a <webview> refused to open a window for "
               << target_url.possibly_invalid_spec()
               << "; new windows from a guest are not wired up yet.";
  return nullptr;
}

void WebViewGuest::WebContentsDestroyed() {
  guest_contents_ = nullptr;
  if (self_owned_) {
    delete this;
  }
}

void BindWebViewGuestHost(
    content::RenderFrameHost* frame,
    mojo::PendingReceiver<mojom::WebViewGuestHost> receiver) {
  // Owns itself and goes with the document. `new` with no matching delete is
  // what DocumentService is.
  new WebViewGuestHost(*frame, std::move(receiver));
}

}  // namespace domicile
