// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/html_frame_element_base.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"

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
// It is a frame owner, so the nested browsing context is the one <iframe>
// creates and everything downstream of that -- process allocation, site
// isolation, navigation, focus -- is Chromium's own.
//
// KNOWN GAP, and it is the one thing Electron's <webview> bought that this does
// not: a frame owner is a frame, so X-Frame-Options and CSP frame-ancestors
// apply, and a site that refuses to be framed will refuse to load here.
// Electron avoided that by making its <webview> a separate WebContents behind
// the guest-view machinery, which is a subsystem this fork would have to carry
// whole. Closing it is its own piece of work; see docs/architecture/
// ENGINE-FORK.md in the Domicile repository.
class CORE_EXPORT HTMLWebViewElement final : public HTMLFrameElementBase {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLWebViewElement(Document&);
  ~HTMLWebViewElement() override;

  // The navigation surface a chrome's address bar drives. Each is the
  // corresponding operation on the nested context's own history, so a shell
  // does not have to reach for the page inside.
  //
  // SAME-PROCESS ONLY. These reach the nested context's History directly, which
  // exists only while that context is a LocalFrame. A <webview> that Chromium
  // has put in a process of its own has a RemoteFrame here and these do
  // nothing -- which is most cross-site navigations, so a shell's address bar
  // stops working exactly when the user browses away from where it started.
  // Driving history across a process boundary is the browser's to do, and
  // wiring that is its own piece of work.
  void goBack(ScriptState*, ExceptionState&);
  void goForward(ScriptState*, ExceptionState&);
  void stop();
  void reload();

 private:
  LayoutObject* CreateLayoutObject(const ComputedStyle&) override;

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
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
