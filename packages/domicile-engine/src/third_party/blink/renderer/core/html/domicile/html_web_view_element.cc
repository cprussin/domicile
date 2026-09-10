// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/parser/html_parser_idioms.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"

namespace blink {

HTMLWebViewElement::HTMLWebViewElement(Document& document)
    : HTMLFrameElementBase(html_names::kWebviewTag, document),
      // Null in a document with no window -- a template's, say -- and that is
      // what HeapMojoRemote takes it for. Nothing binds until there is a frame
      // to name anyway.
      guest_(document.GetExecutionContext()) {}

HTMLWebViewElement::~HTMLWebViewElement() = default;

void HTMLWebViewElement::Trace(Visitor* visitor) const {
  visitor->Trace(guest_);
  HTMLFrameElementBase::Trace(visitor);
}

void HTMLWebViewElement::ParseAttribute(
    const AttributeModificationParams& params) {
  // THE ONE ATTRIBUTE THIS ELEMENT DOES NOT INHERIT. HTMLFrameElementBase
  // answers `src` by navigating the frame it owns; here that frame is the
  // guest's attach point and must stay on about:blank, so the address goes to
  // the guest instead and the frame is left alone.
  if (params.name == html_names::kSrcAttr) {
    NavigateGuest();
  } else {
    HTMLFrameElementBase::ParseAttribute(params);
  }
}

void HTMLWebViewElement::DidNotifySubtreeInsertionsToDocument() {
  // This is what creates the nested browsing context, and with `src` withheld
  // it creates one on about:blank -- which is what AttachInnerWebContents
  // wants: "generally a frame same-process with its parent is the right choice
  // but ideally it should be about:blank to avoid problems with beforeunload".
  HTMLFrameElementBase::DidNotifySubtreeInsertionsToDocument();
  RequestGuest();
  // A parsed <webview src="..."> has already been through ParseAttribute, at a
  // point where there was no guest to send to. This is the send it missed.
  NavigateGuest();
}

void HTMLWebViewElement::RequestGuest() {
  if (guest_.is_bound()) {
    return;
  }
  ExecutionContext* context = GetDocument().GetExecutionContext();
  if (!context) {
    return;
  }
  // The frame the owner made, still local and still on about:blank. Absent
  // when subframe loading is disabled or the document has no frame, in which
  // case there is no placeholder to attach anything to.
  LocalFrame* placeholder = DynamicTo<LocalFrame>(ContentFrame());
  if (!placeholder) {
    return;
  }

  // The factory is a one-shot: it exists to hand over the pipe below, and the
  // request is written to it before this remote goes out of scope. The pipe
  // that matters is `guest_`, which lives as long as the element.
  mojo::Remote<domicile::mojom::blink::WebViewGuestHost> host;
  context->GetBrowserInterfaceBroker().GetInterface(
      host.BindNewPipeAndPassReceiver());
  host->CreateGuest(placeholder->GetLocalFrameToken(),
                    guest_.BindNewPipeAndPassReceiver(
                        context->GetTaskRunner(TaskType::kInternalDefault)));
}

void HTMLWebViewElement::NavigateGuest() {
  if (!guest_.is_bound()) {
    return;
  }
  const AtomicString& source = FastGetAttribute(html_names::kSrcAttr);
  if (source.IsNull()) {
    return;
  }
  // Resolved against this document, the way an <iframe src> is, so a shell can
  // write a relative address and mean the same thing by it.
  //
  // An address that does not resolve is sent anyway, and that is deliberate:
  // an <iframe> with a nonsense src navigates and shows an error page, and a
  // <webview> that silently did nothing instead would leave a shell's address
  // bar looking like it had worked.
  guest_->Navigate(
      GetDocument().CompleteURL(StripLeadingAndTrailingHtmlSpaces(source)));
}

LayoutObject* HTMLWebViewElement::CreateLayoutObject(
    const ComputedStyle& style) {
  return MakeGarbageCollected<LayoutIFrame>(this);
}

network::ParsedPermissionsPolicy HTMLWebViewElement::ConstructContainerPolicy()
    const {
  // No `allow` attribute, so nothing is delegated: the nested context gets the
  // policy it would get from an <iframe> with no allow list. A shell that needs
  // to hand a feature down should say so explicitly, and that is a change worth
  // making deliberately rather than by inheriting a permissive default.
  return network::ParsedPermissionsPolicy();
}

// The history controls, and they reach the guest.
//
// EACH IS ONE MESSAGE AND NOTHING ELSE, which is the whole of the wiring: the
// page a <webview> shows is a WebContents in the browser process, its history
// is a NavigationController there, and this process cannot see either. What
// used to be here drove `ContentFrame()` -- the placeholder, on about:blank
// since it was made and swapped out by the attach -- so all four did nothing.
//
// AN UNBOUND REMOTE IS A NO-OP RATHER THAN A THROW, and it is the same
// condition `NavigateGuest` already answers that way: the pipe is bound in
// DidNotifySubtreeInsertionsToDocument, so an element that is not in a
// document has no guest yet and a shell that drove one would be pressing a
// button on a window that is not on screen. There is nothing to report and
// nothing to recover.
void HTMLWebViewElement::goBack() {
  if (guest_.is_bound()) {
    guest_->GoBack();
  }
}

void HTMLWebViewElement::goForward() {
  if (guest_.is_bound()) {
    guest_->GoForward();
  }
}

void HTMLWebViewElement::stop() {
  if (guest_.is_bound()) {
    guest_->Stop();
  }
}

void HTMLWebViewElement::reload() {
  if (guest_.is_bound()) {
    guest_->Reload();
  }
}

}  // namespace blink
