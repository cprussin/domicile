// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/parser/html_parser_idioms.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"

namespace blink {

// What this element says when the page inside it takes focus. Not a `focus`
// event: see GuestTookFocus in the header for why there cannot be one, and
// packages/chrome-sdk/src/webview-element.ts for the other end of the name.
//
// A char array rather than an AtomicString: the atom table does not exist at
// static-initialisation time, so the string is made where it is used.
constexpr char kGuestFocusEvent[] = "domicile-guest-focus";

// And what it says when the guest's history changes what it can do. It carries
// nothing: `canGoBack` and `canGoForward` are readable on the element at any
// moment, and a detail here would be a second copy of them that is right only
// at the instant it was made. See the header for why the state is the property
// and not this.
constexpr char kHistoryChangeEvent[] = "domicile-history-change";

HTMLWebViewElement::HTMLWebViewElement(Document& document)
    : HTMLFrameElementBase(html_names::kWebviewTag, document),
      // Null in a document with no window -- a template's, say -- and that is
      // what HeapMojoRemote takes it for. Nothing binds until there is a frame
      // to name anyway.
      guest_(document.GetExecutionContext()),
      client_receiver_(this, document.GetExecutionContext()) {}

HTMLWebViewElement::~HTMLWebViewElement() = default;

void HTMLWebViewElement::Trace(Visitor* visitor) const {
  visitor->Trace(guest_);
  visitor->Trace(client_receiver_);
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
  // BOTH ENDS IN ONE MESSAGE. The browser creates the guest from this call, so
  // a client handed over afterwards would leave a window in which the guest
  // could commit a page and have nothing to tell about it -- and the first
  // thing a guest does is commit a page.
  //
  // The task runner is named once and passed twice, without a move: argument
  // evaluation order is unspecified, so a moved-from runner could reach the
  // other pipe.
  const scoped_refptr<base::SingleThreadTaskRunner> task_runner =
      context->GetTaskRunner(TaskType::kInternalDefault);
  host->CreateGuest(placeholder->GetLocalFrameToken(),
                    guest_.BindNewPipeAndPassReceiver(task_runner),
                    client_receiver_.BindNewPipeAndPassRemote(task_runner));
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

void HTMLWebViewElement::SetFocused(bool received,
                                   mojom::blink::FocusType type) {
  // UNCONDITIONAL, AND BEFORE ANYTHING ELSE. Three engine runs have now ended
  // with this element as document.activeElement and no announcement, and the
  // only way to tell "this override never ran" from "it ran with received
  // false" is a line that does not depend on either. The pair of lines in
  // DispatchGuestFocus cannot: they are inside the case being asked about.
  LOG(INFO) << "domicile: <webview> SetFocused received=" << received;

  HTMLFrameElementBase::SetFocused(received, type);
  if (received) {
    DispatchGuestFocus();
  }
}

void HTMLWebViewElement::DispatchGuestFocus() {
  // TWO LINES IN THE ENGINE'S OWN LOG, because a shell that hears nothing
  // cannot say which half was missing and a guard reading only the page
  // cannot either. Engine runs 186 and 192 both ended with the element as
  // document.activeElement and no event anywhere -- which says
  // Document::SetFocusedElement ran and reached SetFocused, and says nothing
  // at all about what happened next. With these, a run separates "this never
  // ran" from "it ran and the page heard nothing", which are faults in two
  // different layers. guard-webview-click.sh reads them.
  LOG(INFO) << "domicile: a <webview>'s guest took focus; announcing it";

  // DISPATCHED HERE, AND THAT IS THE CHANGE RUN 192 ARGUES FOR. Both earlier
  // attempts deferred it -- one through a ScopedEventQueue, one through a
  // posted task -- out of a worry about re-entering focus bookkeeping that is
  // halfway through. Neither ever arrived. What upstream does from this exact
  // call is dispatch: Document::SetFocusedElement's own comment two lines past
  // the SetFocused call reads "Element::setFocused for frames can dispatch
  // events", and the branch under it handles a handler that moved focus again.
  // So the re-entrancy this was avoiding is one the caller already expects,
  // and avoiding it cost the event entirely.
  //
  // Bubbling, because that is what a chrome is written against: a shell hangs
  // one handler on the window it drew and hears both halves of it -- the
  // chrome's own pointer events and this -- through the same listener. See
  // BrowserWindow.tsx in the Domicile repository.
  DispatchEvent(*Event::CreateBubble(AtomicString(kGuestFocusEvent)));

  // After, so the pair brackets the dispatch: a run with the first line and
  // not the second is a handler that never returned, which reads identically
  // to a dispatch that never happened from anywhere but here.
  LOG(INFO) << "domicile: announced a <webview>'s guest focus";
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

// The browser's answer arriving, which is the only way this element has one.
//
// STORED FIRST AND ANNOUNCED SECOND, because the announcement is what makes a
// chrome read the store: a handler that ran before the fields were written
// would read the values it was called about the change to.
void HTMLWebViewElement::HistoryChanged(bool can_go_back, bool can_go_forward) {
  can_go_back_ = can_go_back;
  can_go_forward_ = can_go_forward;

  // Bubbling, for the reason the focus announcement bubbles: a shell hangs one
  // handler on the window it drew and hears everything that window's parts say
  // through it. See BrowserWindow.tsx in the Domicile repository.
  DispatchEvent(*Event::CreateBubble(AtomicString(kHistoryChangeEvent)));
}

}  // namespace blink
