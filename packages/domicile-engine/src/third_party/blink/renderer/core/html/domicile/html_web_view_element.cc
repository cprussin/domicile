// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/history.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/parser/html_parser_idioms.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/core/loader/frame_load_request.h"
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

// The history controls, and they now reach the wrong page. They drive the
// placeholder frame's History, and the placeholder has been on about:blank
// since it was made -- the guest's own NavigationController is in the browser
// process and nothing here can reach it. So these do nothing rather than
// throwing at a shell driving them from an address bar, which is the same
// behaviour they had before and for a different reason.
//
// Wiring them to the guest is a known gap, and ROADMAP.md carries it.
// It is also the half of it that gets *better*: a guest has a history of its
// own, the way Electron's <webview> did because it was a WebContents of its
// own, where a frame shared the whole session's.
LocalDOMWindow* HTMLWebViewElement::ContentWindow() const {
  LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame());
  return frame ? frame->DomWindow() : nullptr;
}

void HTMLWebViewElement::goBack(ScriptState* script_state,
                                ExceptionState& exception_state) {
  if (LocalDOMWindow* window = ContentWindow()) {
    window->history()->back(script_state, exception_state);
  }
}

void HTMLWebViewElement::goForward(ScriptState* script_state,
                                   ExceptionState& exception_state) {
  if (LocalDOMWindow* window = ContentWindow()) {
    window->history()->forward(script_state, exception_state);
  }
}

void HTMLWebViewElement::stop() {
  if (LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame())) {
    frame->Loader().StopAllLoaders(/*abort_client=*/true);
  }
}

void HTMLWebViewElement::reload() {
  if (LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame())) {
    frame->Reload(WebFrameLoadType::kReload);
  }
}

}  // namespace blink
