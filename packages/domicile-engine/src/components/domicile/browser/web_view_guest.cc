// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/web_view_guest.h"

#include <memory>
#include <string>
#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/logging.h"
#include "base/memory/ptr_util.h"
#include "components/domicile/browser/shortcut_registry.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/page_navigator.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_process_host.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
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
      mojo::PendingReceiver<mojom::WebViewGuest> guest,
      mojo::PendingRemote<mojom::WebViewGuestClient> client) override {
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
                                  std::move(guest), std::move(client));
  }
};

}  // namespace

// static
void WebViewGuest::CreateAndAttach(
    content::RenderFrameHost& owner,
    content::RenderFrameHost& placeholder,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client) {
  std::unique_ptr<WebViewGuest> guest = base::WrapUnique(
      new WebViewGuest(owner, std::move(receiver), std::move(client)));

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

WebViewGuest::WebViewGuest(
    content::RenderFrameHost& owner,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client)
    : owner_rfh_id_(owner.GetGlobalId()),
      receiver_(this, std::move(receiver)),
      client_(std::move(client)) {}

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
  // nowhere to go. An address bar whose buttons cannot yet be grayed out
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
  // navigation is the WebContents', and canceling it is what an address bar's
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

void WebViewGuest::NavigationStateChanged(
    content::WebContents* source,
    content::InvalidateTypes changed_flags) {
  ReportHistory();
}

void WebViewGuest::LoadingStateChanged(content::WebContents* source,
                                       bool should_show_loading_ui) {
  ReportLoading(should_show_loading_ui);
}

void WebViewGuest::ReportHistory() {
  // The same CHECK the four controls make: this object is destroyed with the
  // guest's WebContents, and content does not call a delegate of a WebContents
  // it has already destroyed.
  CHECK(guest_contents_);

  content::NavigationController& history = guest_contents_->GetController();
  const bool can_go_back = history.CanGoBack();
  const bool can_go_forward = history.CanGoForward();

  // A CHANGE, not a notification. See the header: this call is also how a
  // title and a favicon arrive, and a chrome that re-rendered its address bar
  // for a favicon would be re-rendering it for every page it loads.
  if (can_go_back != reported_can_go_back_ ||
      can_go_forward != reported_can_go_forward_) {
    reported_can_go_back_ = can_go_back;
    reported_can_go_forward_ = can_go_forward;
    client_->HistoryChanged(can_go_back, can_go_forward);
  }
}

void WebViewGuest::ReportLoading(bool should_show_loading_ui) {
  // The same CHECK ReportHistory makes, and for the same reason: content does
  // not call a delegate of a WebContents it has already destroyed.
  CHECK(guest_contents_);

  // BOTH HALVES, which is how Chrome's own browser window reads this pair:
  // `should_show_loading_ui` says whether a load of this kind is one a browser
  // spins for -- false for a same-document navigation -- and `IsLoading()`
  // says whether one is happening at all. A spinner driven by the flag alone
  // would keep turning after the page arrived, because the call that says a
  // load finished carries the same flag as the call that said it started.
  const bool loading = guest_contents_->IsLoading() && should_show_loading_ui;

  // A CHANGE, not a notification, exactly as ReportHistory is: this call
  // arrives for navigations that start no load a browser would show, and a
  // chrome that re-rendered its address bar for each of them would be
  // re-rendering it for nothing.
  if (loading != reported_loading_) {
    reported_loading_ = loading;
    client_->LoadingChanged(loading);
  }
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
  // NOT THE WINDOW, WHICH THIS CANNOT MAKE: a guest with no SiteInstance of its
  // own is what keeps the user logged in -- see the class comment -- and
  // content CHECKs that pair in WebContentsImpl::CreateNewWindow. So the window
  // is refused, exactly as it was before this message existed, and the address
  // goes to the element. What opens a window is the shell.
  //
  // `disposition` and `window_features` are not carried, and that is the same
  // decision the class makes about everything else an embedder is asked: a
  // Domicile shell has one shape of browser window and lays it out itself, so a
  // popup's requested size is an answer to a question its desktop does not ask.
  ReportNewWindow(target_url);
  return nullptr;
}

content::WebContents* WebViewGuest::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  // The same CHECK the four controls make: this object is destroyed with the
  // guest's WebContents, so there is no moment at which content can call this
  // delegate and the WebContents be gone.
  CHECK(guest_contents_);

  // `guest_contents_` RATHER THAN `source`, which is the same object here and
  // says less: this delegate is set on one WebContents and only that one can
  // reach it, so naming the guest says which page is being navigated where the
  // parameter only says "whoever called".
  switch (params.disposition) {
    case WindowOpenDisposition::CURRENT_TAB: {
      // THE PAGE THE FRAME COULD NOT REACH, reached. LoadURLParams carries the
      // referrer, the transition, the POST body and the initiator origin across
      // from what the renderer asked for, which is what keeps this a
      // continuation of the navigation rather than a fresh one at the same
      // address.
      //
      // Said BEFORE the load rather than after, so the line means "the browser
      // was asked" and nothing more: whether the page then arrives is the other
      // half of the claim and is read from the page itself.
      // `guard-webview-routed-link.sh` greps for this, and it is what tells a
      // navigation this delegate routed from one Blink retargeted inside a
      // single process -- which moves the window just the same and measures
      // nothing.
      LOG(INFO) << "domicile: a <webview> followed a link its page could not "
                   "follow itself, to "
                << params.url.possibly_invalid_spec();

      base::WeakPtr<content::NavigationHandle> navigation =
          guest_contents_->GetController().LoadURLWithParams(
              content::NavigationController::LoadURLParams(params));

      // The callback is content's way of handing the caller the navigation it
      // just asked for, and a null handle is an ordinary answer rather than a
      // failure: a navigation the controller refused -- an unsupported scheme,
      // a URL a renderer may not ask for -- never starts one.
      if (navigation_handle_callback && navigation) {
        std::move(navigation_handle_callback).Run(*navigation);
      }
      return guest_contents_;
    }

    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
    case WindowOpenDisposition::NEW_POPUP:
    case WindowOpenDisposition::NEW_WINDOW: {
      // A SECOND WINDOW, WHICH IS THE SHELL'S, and the same answer
      // CreateCustomWebContents gives -- this is the other door into it. A
      // middle click and a Ctrl click arrive here rather than there, so a
      // desktop that answered only one of the two would open a window for a
      // `target="_blank"` and do nothing for the same link middle-clicked.
      ReportNewWindow(params.url);
      return nullptr;
    }

    default: {
      // EVERYTHING ELSE IS REFUSED AND SAID OUT LOUD. Saving to disk, a
      // singleton tab, a switch to a tab that exists, an off-the-record window:
      // each is a piece of browser UI this desktop does not have, and a silent
      // return here is exactly the failure this whole override exists to undo.
      //
      // A `default` rather than an arm each, deliberately: this is a
      // //ui/base enum shared with all of Chromium, and a value added upstream
      // would turn an exhaustive switch into a build failure on a rebase for a
      // case the fork has no opinion about. The ones this desktop answers are
      // written out above; the rest are one sentence.
      LOG(WARNING) << "domicile: a <webview> refused a navigation to "
                   << params.url.possibly_invalid_spec()
                   << " asked for with a disposition a browser window has no "
                      "answer for: "
                   << static_cast<int>(params.disposition);
      return nullptr;
    }
  }
}

void WebViewGuest::ReportNewWindow(const GURL& target_url) {
  // AN ADDRESS OR NOTHING, and the invalid case is the one to say out loud: a
  // `window.open()` with no url asks for a handle to write a document into,
  // which is precisely what a window the shell navigates to cannot be. Sending
  // it anyway would open a browser window at nothing, in answer to a script
  // that is about to write into a handle it did not get.
  if (!target_url.is_valid()) {
    LOG(WARNING) << "domicile: a <webview>'s page asked for a window with no "
                    "address to open; refused, and the shell is not told.";
    return;
  }

  client_->NewWindowRequested(target_url);

  // A warning rather than an info, because a refusal is still what happened:
  // what the user gets is a window the shell opened at this address, not the
  // window the page asked for. A run where the two differ -- an opener that was
  // needed, a POST that became a GET -- starts here.
  LOG(WARNING) << "domicile: a <webview> refused to open a window for "
               << target_url.possibly_invalid_spec()
               << "; the shell was asked to open one instead.";
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
