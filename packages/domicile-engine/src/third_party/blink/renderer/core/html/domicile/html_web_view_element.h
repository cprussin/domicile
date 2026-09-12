// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/html_frame_element_base.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_receiver.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"

namespace blink {

// <webview> — web content in a browsing context of its own.
//
// The tag exists because Domicile's shells are written against it: a browser
// shell puts the page it is browsing in a <webview>, and drives it from an
// address bar with src, goBack(), goForward(), stop() and reload(). It cannot
// be a custom element for the same reason <app> cannot -- a custom element's
// name must contain a hyphen -- so the fork defines it, which is also how
// Electron's <webview> came to exist.
//
// It is still a frame owner, and the nested browsing context it creates is
// still Chromium's -- but that context is NOT where the page goes. The frame
// stays on about:blank and becomes the attach point for a guest: `src` is sent
// to the browser over WebViewGuestHost, which creates a WebContents and
// attaches it there with AttachInnerWebContents.
//
// WHY, in one sentence: a frame owner is a frame, so as a frame this element
// was refused by every site that sends X-Frame-Options or CSP frame-ancestors
// -- the one thing Electron's guest-view <webview> bought that this did not.
// A guest's main frame is a main frame and has no ancestor to check. It also
// gets history that survives a process change and storage that is not
// partitioned as a third party's. See components/domicile/browser/
// web_view_guest.h.
//
// KNOWN GAP: `srcdoc` is not intercepted, so setting it still navigates the
// placeholder frame out from under the guest. A <webview> has no srcdoc in its
// IDL and nothing in this repository sets one; intercepting it would be a
// branch no guard covers.
class CORE_EXPORT HTMLWebViewElement final
    : public HTMLFrameElementBase,
      public domicile::mojom::blink::WebViewGuestClient {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLWebViewElement(Document&);
  ~HTMLWebViewElement() override;

  // Which element this is, for `DynamicTo` and `IsA`. NOT boilerplate, and
  // nothing in a build says so if it is missing: `DowncastTraits<HTMLWebViewElement>`
  // is generated as a comparison against this value, and HTMLElement's base
  // answers `kHTMLElement` for anything that does not override it. So an
  // element without this parses, lays out and reflects its attributes exactly
  // as it should, and every cast back to its own class returns null. See
  // node.h -- "every HTMLElement must override this" -- and
  // scripts/test-fork-elements-know-their-type.sh, which is what now says so.
  ElementType GetElementType() const final {
    return ElementType::kHTMLWebViewElement;
  }

  // The navigation surface a chrome's address bar drives. Each is the
  // corresponding operation on the GUEST's own history, sent to the browser
  // over the same pipe `src` goes down.
  //
  // NOT THE PLACEHOLDER'S History, which is what these used to reach and why
  // all four did nothing: this element is a frame owner, so it has a nested
  // browsing context -- but that context is the attach point, it has been on
  // about:blank since it was made, and the attach swapped it out. The page a
  // user sees is a WebContents in the browser process and its history is a
  // NavigationController there.
  //
  // NOTHING IS THROWN AND NOTHING IS RETURNED. `History::back()` raises when
  // the frame is detached and when a sandboxed document may not navigate its
  // top; neither has a counterpart here -- there is one pipe, it is bound for
  // the element's whole life, and a browser that has torn the guest down has
  // closed it. A back with nowhere to go is not an error either: the browser's
  // controller answers it by not navigating, which is what an address bar
  // whose buttons cannot yet be greyed out asks for constantly.
  void goBack();
  void goForward();
  void stop();
  void reload();

  // WHETHER EITHER OF THE FIRST TWO WOULD DO ANYTHING, so an address bar can
  // grey out a button that would not.
  //
  // A PROPERTY, NOT AN EVENT'S PAYLOAD, and that is the decision this pair
  // records. A shell renders from state: it is handed a moment and asked what
  // the window looks like now, and the answer has to be readable at that
  // moment rather than have been announced at some earlier one. An availability
  // that existed only in an event would be gone for a chrome that mounted after
  // the guest's first commit -- a React shell registers its listeners in its
  // first effect flush, which is after the element is in the document -- and
  // its Back button would stay wrong until the user navigated again. So the
  // value is here, always, and `domicile-history-change` only says to read it
  // again.
  //
  // NOT A CONTENT ATTRIBUTE either, which is the other shape a chrome could
  // read: a content attribute is the author's, it serialises into innerHTML,
  // and a shell or a devtools user writing one would make the DOM say something
  // the browser never did.
  //
  // AND NOT A SYNCHRONOUS ASK, which is the shape that would need no pushing at
  // all: the answer is a NavigationController's in the browser process, so
  // reading it on demand means a blocking round trip out of a renderer inside a
  // property read. The browser pushes instead -- see WebViewGuestClient in
  // components/domicile/mojom/web_view_guest.mojom -- and this is where it
  // lands.
  bool canGoBack() const { return can_go_back_; }
  bool canGoForward() const { return can_go_forward_; }

  void Trace(Visitor*) const override;

 private:
  /**
   * Say, in an event, that this element has been focused.
   *
   * WHY AN EVENT OF ITS OWN, RATHER THAN THE FOCUS EVENT THAT WOULD NORMALLY
   * FOLLOW. Document::SetFocusedElement dispatches `focus` and `focusin` only
   * while the page is focused -- "if page lost focus, event will be dispatched
   * on page focus, don't duplicate" -- and a guest taking focus is exactly the
   * moment the embedder's page has lost it: WebContentsImpl::
   * SetFocusedFrameTree sends the old tree's widget SetPageFocus(false) BEFORE
   * FocusOuterFrameTrees tells this renderer anything. So the element becomes
   * document.activeElement and not one event is dispatched, which is a shell
   * being told nothing at all in the case it most needs telling: a click in a
   * browser window's page, which is what raises the window.
   *
   * Measured rather than reasoned. guard-webview-click.sh drove a real press
   * into a guest and read `activeElement=webview hasFocus=false` out of the
   * embedder's document with no event of any kind beside it.
   *
   * HUNG OFF SetFocused RATHER THAN OFF THE FOCUS CONTROLLER'S CALL, and that
   * is the same measurement read a second time. Document::SetFocusedElement
   * calls SetFocused on whatever it focuses, unconditionally, so an element
   * that is activeElement has had this run -- whichever route the focus came
   * by. A call from the patched branch would fire only if that branch is the
   * route, which is an inference and not a reading.
   *
   * Patch 0011 moves HTMLFrameElementBase::SetFocused out of that class's
   * private section for this: a subclass may override a private virtual, and
   * may not call one, and the base's own work -- handing the content frame the
   * focus -- still has to happen.
   */
  void SetFocused(bool received, mojom::blink::FocusType) override;

  /**
   * The dispatch itself, and it is synchronous. Two earlier shapes deferred it
   * -- a ScopedEventQueue, then a posted task -- to keep a handler out of focus
   * bookkeeping that is halfway through, and neither event ever arrived
   * (engine runs 186 and 192). Document::SetFocusedElement expects this: its
   * own comment beside the SetFocused call is "Element::setFocused for frames
   * can dispatch events", and the branch under it handles a handler that moved
   * focus again. It also writes two lines to the engine log around the
   * dispatch, which is how a run says whether this ran at all.
   */
  void DispatchGuestFocus();

  LayoutObject* CreateLayoutObject(const ComputedStyle&) override;

  // `src` never reaches HTMLFrameElementBase, which would navigate the
  // placeholder frame. Everything else does.
  void ParseAttribute(const AttributeModificationParams&) override;

  // The base creates the placeholder frame here, on about:blank, because
  // ParseAttribute kept `src` from it. That frame is what the guest attaches
  // to, so this is the first moment there is anything to ask for.
  void DidNotifySubtreeInsertionsToDocument() override;

  // Ask the browser for a guest for the placeholder frame. Does nothing when
  // there is already one, or when there is no placeholder to name yet.
  void RequestGuest();

  // Send the current `src` to the guest. Safe before the attach finishes: the
  // browser holds the guest's WebContents from the moment it is created, and a
  // navigation started before it is attached is one content brings up with it.
  void NavigateGuest();

  // kIframe rather than a value of its own. Everything that switches on the
  // owner type -- process allocation, the frame tree the browser keeps, devtools
  // -- wants to treat this exactly as it treats an <iframe>, and adding a case
  // to a mojom enum shared with //content would put the fork in every one of
  // those switches for no behaviour it wants to differ.
  FrameOwnerElementType OwnerType() const final {
    return FrameOwnerElementType::kIframe;
  }

  network::ParsedPermissionsPolicy ConstructContainerPolicy() const override;

  // domicile::mojom::blink::WebViewGuestClient:
  //
  // The browser saying what the guest's history can do now. It arrives when it
  // CHANGES and not otherwise, so there is no case in which this stores what it
  // already held -- and the event below is therefore never dispatched for a
  // change that is not one.
  void HistoryChanged(bool can_go_back, bool can_go_forward) override;

  // The guest, for as long as this element lives. Bound once, and not
  // rebuilt on a later `src`: the placeholder frame is destroyed by the
  // attach, so there would be nothing left to name in a second request.
  HeapMojoRemote<domicile::mojom::blink::WebViewGuest> guest_;

  // The other direction, handed over in the same CreateGuest that asks for the
  // guest -- so the browser can never have a history to report and nowhere to
  // report it to.
  HeapMojoReceiver<domicile::mojom::blink::WebViewGuestClient,
                   HTMLWebViewElement>
      client_receiver_;

  // What the browser last said. False both until it says otherwise, which is
  // not a guess: a guest that has been nowhere has no entry behind it and none
  // ahead, so the browser's first answer for a fresh guest is this one and it
  // does not spend a message saying so.
  bool can_go_back_ = false;
  bool can_go_forward_ = false;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
