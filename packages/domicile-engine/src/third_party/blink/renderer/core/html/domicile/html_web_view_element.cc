// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_keyboard_event_init.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/core/events/keyboard_event.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/domicile/domicile_file_chooser_event.h"
#include "third_party/blink/renderer/core/html/domicile/domicile_new_window_event.h"
#include "third_party/blink/renderer/core/html/parser/html_parser_idioms.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"

namespace blink {

// What this element says when the page inside it takes focus. Not a `focus`
// event: see GuestTookFocus in the header for why there cannot be one, and
// packages/chrome-sdk/src/webview-element.ts for the other end of the name.
//
// A char array rather than an AtomicString: the atom table does not exist at
// static-initialization time, so the string is made where it is used.
constexpr char kGuestFocusEvent[] = "domicile-guest-focus";

// And what it says when the guest's history changes what it can do. It carries
// nothing: `canGoBack` and `canGoForward` are readable on the element at any
// moment, and a detail here would be a second copy of them that is right only
// at the instant it was made. See the header for why the state is the property
// and not this.
constexpr char kHistoryChangeEvent[] = "domicile-history-change";

// And what it says when a page starts or stops arriving. Carries nothing for
// the same reason: `loading` is readable on the element at any moment, which
// is what a chrome that mounted in the middle of a load needs and what an
// event's detail cannot be.
constexpr char kLoadingChangeEvent[] = "domicile-loading-change";

// And what it says when the page inside asks for a window of its own. The one
// of the four that carries anything: what is being asked for is an address
// nothing is showing yet, so there is no property on this element for a chrome
// to read it off. See domicile_new_window_event.h.
constexpr char kNewWindowEvent[] = "domicile-new-window";

// And what it says when the page it is showing changes -- its address, the
// browser's verdict on the connection behind it, or both. Carries nothing, for
// the reason the history and loading events carry nothing: `url` and
// `security` are readable on the element at any moment, which is what a chrome
// that mounted mid-load needs, and a detail here would be a second copy right
// only at the instant it was made.
constexpr char kPageChangeEvent[] = "domicile-page-change";

// And what it says about the keyboard and the zoom. A chord the page left alone
// arrives as a KeyboardEvent of its own type -- not `keydown`, which would
// reach every keydown listener in the shell as a key pressed in the shell's
// own document. The zoom change carries nothing, like the other state events:
// `zoom` is readable on the element. The two requests carry their direction in
// their names, which keeps them plain Events rather than an event type of the
// fork's own.
constexpr char kGuestKeydownEvent[] = "domicile-guest-keydown";
constexpr char kZoomChangeEvent[] = "domicile-zoom-change";
constexpr char kZoomInRequestEvent[] = "domicile-zoom-in-request";
constexpr char kZoomOutRequestEvent[] = "domicile-zoom-out-request";

// And what it says when a find in the page has found something new. Carries
// nothing, like the other state events: `findMatches` and `findActiveMatch`
// are readable on the element.
constexpr char kFindChangeEvent[] = "domicile-find-change";

// And what it asks when the page needs a file picked -- the one event here
// that is a question, answered on the event itself. See
// domicile_file_chooser_event.h.
constexpr char kFileChooserEvent[] = "domicile-file-chooser";

// And what it says when the page inside calls window.close(). Carries nothing:
// what is closing is this element's page, and the element is the target.
constexpr char kCloseEvent[] = "domicile-close";

// And what it says when an extension asks for this window to be in front.
// Carries nothing: the element is the target.
constexpr char kFocusRequestEvent[] = "domicile-focus-request";

// The four values `security` can take, which are the four the browser's own
// omnibox draws. Strings rather than an IDL enum -- see the .idl for why -- and
// named here so the element and the SDK have one spelling between them.
constexpr char kSecurityNeutral[] = "neutral";
constexpr char kSecureSecurity[] = "secure";
constexpr char kSecurityWarning[] = "warning";
constexpr char kSecurityDangerous[] = "dangerous";

// The browser's verdict as the string the element reports.
//
// AN EXPLICIT SWITCH WITH NO DEFAULT ARM, which is the same decision
// AsWebViewSecurity makes on the browser side and for the same reason: a value
// added to the mojom enum has to stop this build rather than reach a shell as
// a level it has never heard of.
const char* SecurityName(domicile::mojom::blink::WebViewSecurity security) {
  switch (security) {
    case domicile::mojom::blink::WebViewSecurity::kNeutral:
      return kSecurityNeutral;
    case domicile::mojom::blink::WebViewSecurity::kSecure:
      return kSecureSecurity;
    case domicile::mojom::blink::WebViewSecurity::kWarning:
      return kSecurityWarning;
    case domicile::mojom::blink::WebViewSecurity::kDangerous:
      return kSecurityDangerous;
  }
}

HTMLWebViewElement::HTMLWebViewElement(Document& document)
    : HTMLFrameElementBase(html_names::kWebviewTag, document),
      // Null in a document with no window -- a template's, say -- and that is
      // what HeapMojoRemote takes it for. Nothing binds until there is a frame
      // to name anyway.
      host_(document.GetExecutionContext()),
      guest_(document.GetExecutionContext()),
      client_receiver_(this, document.GetExecutionContext()) {}

HTMLWebViewElement::~HTMLWebViewElement() = default;

void HTMLWebViewElement::Trace(Visitor* visitor) const {
  visitor->Trace(host_);
  visitor->Trace(guest_);
  visitor->Trace(client_receiver_);
  visitor->Trace(waiting_choosers_);
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

  // The task runner is named once and passed three times, without a move:
  // argument evaluation order is unspecified, so a moved-from runner could
  // reach another pipe.
  const scoped_refptr<base::SingleThreadTaskRunner> task_runner =
      context->GetTaskRunner(TaskType::kInternalDefault);
  // Kept open rather than dropped once the request is written: the browser may
  // hold the request on it until it has the placeholder. See `host_`.
  context->GetBrowserInterfaceBroker().GetInterface(
      host_.BindNewPipeAndPassReceiver(task_runner));
  // BOTH ENDS IN ONE MESSAGE. The browser creates the guest from this call, so
  // a client handed over afterward would leave a window in which the guest
  // could commit a page and have nothing to tell about it -- and the first
  // thing a guest does is commit a page.
  host_->CreateGuest(placeholder->GetLocalFrameToken(),
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
                                    mojom::blink::FocusType type,
                                    BlurEventBehavior blur_event_behavior) {
  // UNCONDITIONAL, AND BEFORE ANYTHING ELSE. Three engine runs have now ended
  // with this element as document.activeElement and no announcement, and the
  // only way to tell "this override never ran" from "it ran with received
  // false" is a line that does not depend on either. The pair of lines in
  // DispatchGuestFocus cannot: they are inside the case being asked about.
  LOG(INFO) << "domicile: <webview> SetFocused received=" << received;

  HTMLFrameElementBase::SetFocused(received, type, blur_event_behavior);
  if (received) {
    // The browser first, so the active tab has moved before a shell handling
    // the event below asks an extension anything. Unbound is an element with
    // no guest yet, for NavigateGuest's reason: nothing to make active.
    if (guest_.is_bound()) {
      guest_->Focused();
    }
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

// NOT STORED HERE, unlike every other value the element holds: `zoom` is the
// browser's answer, and the browser may not give the one asked for -- a site
// zoomed by another window a moment later, say. So it changes when
// ZoomChanged says so and not before.
void HTMLWebViewElement::setZoom(double factor,
                                 ExceptionState& exception_state) {
  if (factor < kMinimumBrowserZoomFactor ||
      factor > kMaximumBrowserZoomFactor) {
    exception_state.ThrowRangeError(
        "The zoom factor must be between 0.25 and 5.");
    return;
  }
  if (guest_.is_bound()) {
    guest_->SetZoom(factor);
  }
}

// NOT STORED HERE either, for setZoom's reason: what a find found is the
// browser's to count, across frames this renderer cannot see.
//
// AN UNBOUND REMOTE IS A NO-OP, as it is for the history controls: an element
// that is not in a document has no page to search.
void HTMLWebViewElement::find(const String& text, bool backward) {
  if (guest_.is_bound()) {
    if (text.empty()) {
      // A find bar emptied is a find over, and content refuses to search for
      // nothing: see WebViewGuest.Find.
      guest_->StopFinding(/*keep_selection=*/false);
    } else {
      guest_->Find(text, !backward);
    }
  }
}

void HTMLWebViewElement::stopFinding() {
  if (guest_.is_bound()) {
    guest_->StopFinding(/*keep_selection=*/true);
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

// The same shape as the history answer above, and stored before it is
// announced for the same reason: a handler that ran first would read the value
// it was called about the change to.
void HTMLWebViewElement::LoadingChanged(bool is_loading) {
  loading_ = is_loading;

  DispatchEvent(*Event::CreateBubble(AtomicString(kLoadingChangeEvent)));
}

// The page asking for a window, which is the only thing the browser tells this
// element that is not about the page it already has.
//
// NOTHING IS STORED, unlike the two above, and that is the difference between
// an event and a state: the address is the message. Storing it would mean
// answering "what window was asked for?" between asks, which has no true
// answer.
//
// AND NOTHING IS OPENED HERE. This element cannot make a second one of itself
// and must not try: where a window goes is the shell's, and the shell is what
// hears this. `GetString()` rather than the KURL, because what a chrome does
// with it is write it into another element's `src`.
void HTMLWebViewElement::NewWindowRequested(const KURL& target_url) {
  DispatchEvent(*MakeGarbageCollected<DomicileNewWindowEvent>(
      AtomicString(kNewWindowEvent), target_url.GetString()));
}

void HTMLWebViewElement::PageChanged(
    const KURL& url,
    domicile::mojom::blink::WebViewSecurity security) {
  // BOTH, ALWAYS, AND IN THAT ORDER -- they are written before the event is
  // dispatched so that a handler reading one reads the other's new value too.
  // A chrome that saw a new address beside the last page's lock would be shown
  // a padlock for a page it is no longer on, which is the one failure this
  // whole message exists to prevent.
  url_ = url.GetString();
  security_ = String(SecurityName(security));

  DispatchEvent(*Event::CreateBubble(AtomicString(kPageChangeEvent)));
}

void HTMLWebViewElement::UnhandledKeyDown(const String& key,
                                          const String& code,
                                          bool alt_key,
                                          bool ctrl_key,
                                          bool shift_key,
                                          bool meta_key,
                                          bool repeat) {
  KeyboardEventInit* init = KeyboardEventInit::Create();
  init->setBubbles(true);
  init->setKey(key);
  init->setCode(code);
  init->setAltKey(alt_key);
  init->setCtrlKey(ctrl_key);
  init->setShiftKey(shift_key);
  init->setMetaKey(meta_key);
  init->setRepeat(repeat);
  DispatchEvent(*MakeGarbageCollected<KeyboardEvent>(
      AtomicString(kGuestKeydownEvent), init));
}

// Stored before it is announced, for the reason every state here is.
void HTMLWebViewElement::ZoomChanged(double factor) {
  zoom_ = factor;

  DispatchEvent(*Event::CreateBubble(AtomicString(kZoomChangeEvent)));
}

// Stored before it is announced, for the reason every state here is.
void HTMLWebViewElement::FindChanged(int32_t matches, int32_t active_match) {
  find_matches_ = matches;
  find_active_match_ = active_match;

  DispatchEvent(*Event::CreateBubble(AtomicString(kFindChangeEvent)));
}

void HTMLWebViewElement::ZoomRequested(bool zoom_in) {
  DispatchEvent(*Event::CreateBubble(
      AtomicString(zoom_in ? kZoomInRequestEvent : kZoomOutRequestEvent)));
}

// Held until answered -- see `waiting_choosers_` -- and given up to the
// shell only if somebody took it. An event nobody called `preventDefault()`
// on is a shell that has no picker, and the page is told no rather than left
// waiting for one.
void HTMLWebViewElement::FileChooserRequested(
    domicile::mojom::blink::WebViewFileChooserMode mode,
    const Vector<String>& accept,
    const String& suggested_name,
    const String& home,
    FileChooserRequestedCallback callback) {
  auto* event = MakeGarbageCollected<DomicileFileChooserEvent>(
      AtomicString(kFileChooserEvent), mode, accept, suggested_name, home,
      std::move(callback), *this);
  waiting_choosers_.insert(event);
  DispatchEvent(*event);
  if (!event->defaultPrevented()) {
    event->CancelIfUnanswered();
  }
}

// Bubbling, for the reason the others bubble: a shell hangs one handler on the
// panel it drew and hears everything its parts say through it.
void HTMLWebViewElement::CloseRequested() {
  DispatchEvent(*Event::CreateBubble(AtomicString(kCloseEvent)));
}

// Bubbling, for CloseRequested's reason.
void HTMLWebViewElement::FocusRequested() {
  DispatchEvent(*Event::CreateBubble(AtomicString(kFocusRequestEvent)));
}

void HTMLWebViewElement::FileChooserAnswered(DomicileFileChooserEvent& event) {
  waiting_choosers_.erase(&event);
}

// A CHECK rather than a guard: a chooser is only ever dispatched by the guest,
// so an element holding one has a guest to ask.
void HTMLWebViewElement::ListDirectory(
    const String& path,
    domicile::mojom::blink::WebViewGuest::ListDirectoryCallback listed) {
  CHECK(guest_.is_bound());
  guest_->ListDirectory(path, std::move(listed));
}

}  // namespace blink
