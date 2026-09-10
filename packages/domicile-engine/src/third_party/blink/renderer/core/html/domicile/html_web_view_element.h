// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/html_frame_element_base.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"

namespace blink {

class LocalDOMWindow;

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
// partitioned as a third party's. See docs/architecture/
// BROWSER-WINDOW-PARITY.md in the Domicile repository.
//
// KNOWN GAP: `srcdoc` is not intercepted, so setting it still navigates the
// placeholder frame out from under the guest. A <webview> has no srcdoc in its
// IDL and nothing in this repository sets one; intercepting it would be a
// branch no guard covers.
class CORE_EXPORT HTMLWebViewElement final : public HTMLFrameElementBase {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLWebViewElement(Document&);
  ~HTMLWebViewElement() override;

  // The navigation surface a chrome's address bar drives. Each is the
  // corresponding operation on the nested context's own history, so a shell
  // does not have to reach for the page inside.
  //
  // STILL THE PLACEHOLDER'S, not the guest's, and so still broken -- the guest
  // has a NavigationController of its own and these do not reach it. Wiring
  // them to it is BROWSER-WINDOW-PARITY.md's next piece of work and is not
  // this one; what changed here is where the page lives, not who drives it.
  void goBack(ScriptState*, ExceptionState&);
  void goForward(ScriptState*, ExceptionState&);
  void stop();
  void reload();

  void Trace(Visitor*) const override;

 private:
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

  // The nested context's window, or null when there is not one in this
  // process to reach.
  LocalDOMWindow* ContentWindow() const;

  // The guest, for as long as this element lives. Bound once, and not
  // rebuilt on a later `src`: the placeholder frame is destroyed by the
  // attach, so there would be nothing left to name in a second request.
  HeapMojoRemote<domicile::mojom::blink::WebViewGuest> guest_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
