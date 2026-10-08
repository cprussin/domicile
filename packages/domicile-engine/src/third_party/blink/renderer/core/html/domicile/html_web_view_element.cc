// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include <cstdint>
#include <limits>
#include <optional>

#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/task_type.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_keyboard_event_init.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/events/focus_event.h"
#include "third_party/blink/renderer/core/events/keyboard_event.h"
#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/domicile/domicile_context_menu_event.h"
#include "third_party/blink/renderer/core/html/domicile/domicile_file_chooser_event.h"
#include "third_party/blink/renderer/core/html/parser/html_parser_idioms.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/core/page/focus_controller.h"
#include "third_party/blink/renderer/core/page/page.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"

namespace blink {

// Event names. State events carry no detail: the state is readable on the
// element, so a shell that mounts late still sees it. The other end is
// packages/chrome-sdk/src/webview-element.ts.
//
// Char arrays, not AtomicStrings, because the atom table does not exist at
// static initialization.

// The guest took focus. Not `focus`; see SetFocused in the header.
constexpr char kGuestFocusEvent[] = "domicile-guest-focus";

// State changes.
constexpr char kHistoryChangeEvent[] = "domicile-history-change";
constexpr char kLoadingChangeEvent[] = "domicile-loading-change";
constexpr char kPageChangeEvent[] = "domicile-page-change";

// An unhandled chord, as a KeyboardEvent with its own type so shell `keydown`
// listeners do not mistake it for a key in the shell's document. The zoom
// requests encode direction in the name, so they stay plain Events.
constexpr char kGuestKeydownEvent[] = "domicile-guest-keydown";
constexpr char kZoomChangeEvent[] = "domicile-zoom-change";
constexpr char kZoomInRequestEvent[] = "domicile-zoom-in-request";
constexpr char kZoomOutRequestEvent[] = "domicile-zoom-out-request";

// More state changes.
constexpr char kFaviconChangeEvent[] = "domicile-favicon-change";
constexpr char kFindChangeEvent[] = "domicile-find-change";
constexpr char kContentSizeChangeEvent[] = "domicile-content-size-change";

// A request the shell answers on the event. See
// domicile_file_chooser_event.h.
constexpr char kFileChooserEvent[] = "domicile-file-chooser";

// See domicile_context_menu_event.h.
constexpr char kContextMenuEvent[] = "domicile-context-menu";

// The page called window.close().
constexpr char kCloseEvent[] = "domicile-close";
// An extension asked to raise this window.
constexpr char kFocusRequestEvent[] = "domicile-focus-request";

// Marks the <webview> as an extension action popup, so its guest is a popup
// rather than a tab. Read once, on requesting the guest; only presence
// matters.
constexpr char kExtensionPopupAttr[] = "extensionpopup";

// Makes the guest's page private: in the off-the-record profile. Read once,
// on requesting the guest; only presence matters.
constexpr char kPrivateAttr[] = "private";

// Names the browser window a <webview> shows. Read once, on requesting the
// guest. Not in html_names, to avoid patching Chromium's list. See
// browser_windows.mojom.
constexpr char kWindowAttr[] = "window";

// The values of `security`, matching the omnibox's four levels. Strings, not
// an IDL enum; see the .idl.
constexpr char kSecurityNeutral[] = "neutral";
constexpr char kSecureSecurity[] = "secure";
constexpr char kSecurityWarning[] = "warning";
constexpr char kSecurityDangerous[] = "dangerous";

// Whether `action` is an edit command, which acts on the focused frame. No
// default arm, so a new action fails the build.
bool IsEdit(domicile::mojom::blink::WebViewContextMenuAction action) {
  switch (action) {
    case domicile::mojom::blink::WebViewContextMenuAction::kUndo:
    case domicile::mojom::blink::WebViewContextMenuAction::kRedo:
    case domicile::mojom::blink::WebViewContextMenuAction::kCut:
    case domicile::mojom::blink::WebViewContextMenuAction::kCopy:
    case domicile::mojom::blink::WebViewContextMenuAction::kPaste:
    case domicile::mojom::blink::WebViewContextMenuAction::kPasteAndMatchStyle:
    case domicile::mojom::blink::WebViewContextMenuAction::kDelete:
    case domicile::mojom::blink::WebViewContextMenuAction::kSelectAll:
      return true;
    case domicile::mojom::blink::WebViewContextMenuAction::kCopyLinkAddress:
    case domicile::mojom::blink::WebViewContextMenuAction::kSaveLinkAs:
    case domicile::mojom::blink::WebViewContextMenuAction::kCopyImage:
    case domicile::mojom::blink::WebViewContextMenuAction::kCopyMediaAddress:
    case domicile::mojom::blink::WebViewContextMenuAction::kSaveMediaAs:
    case domicile::mojom::blink::WebViewContextMenuAction::kInspect:
      return false;
  }
}

// Maps the security level to its string. No default, so a new mojom value
// breaks the build.
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
      // Null for a document with no window (e.g. a template's), which
      // HeapMojoRemote accepts. Nothing binds before there is a frame.
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
  // `src` goes to the guest. The base would navigate the placeholder frame,
  // which must stay on about:blank.
  if (params.name == html_names::kSrcAttr) {
    NavigateGuest();
  } else {
    HTMLFrameElementBase::ParseAttribute(params);
  }
}

void HTMLWebViewElement::DidNotifySubtreeInsertionsToDocument() {
  // Creates the placeholder frame on about:blank, as AttachInnerWebContents
  // prefers (to avoid beforeunload problems).
  HTMLFrameElementBase::DidNotifySubtreeInsertionsToDocument();
  RequestGuest();
  // A parsed `src` arrived before there was a guest, so send it now. A browser
  // window's page is already loaded and gets no `src` on attach.
  if (BrowserWindow().IsNull()) {
    NavigateGuest();
  }
}

void HTMLWebViewElement::RequestGuest() {
  if (guest_.is_bound()) {
    return;
  }
  ExecutionContext* context = GetDocument().GetExecutionContext();
  if (!context) {
    return;
  }
  // The local about:blank placeholder. Absent when subframe loading is
  // disabled or the document has no frame.
  LocalFrame* placeholder = DynamicTo<LocalFrame>(ContentFrame());
  if (!placeholder) {
    return;
  }

  // Not moved into the calls below: argument evaluation order is unspecified,
  // so a moved-from runner could reach another pipe.
  const scoped_refptr<base::SingleThreadTaskRunner> task_runner =
      context->GetTaskRunner(TaskType::kInternalDefault);
  // Kept open; see `host_`.
  context->GetBrowserInterfaceBroker().GetInterface(
      host_.BindNewPipeAndPassReceiver(task_runner));
  // The client goes in the same message, so no early report from the guest
  // is lost.
  host_->CreateGuest(placeholder->GetLocalFrameToken(),
                     guest_.BindNewPipeAndPassReceiver(task_runner),
                     client_receiver_.BindNewPipeAndPassRemote(task_runner),
                     BrowserWindow(),
                     hasAttribute(AtomicString(kExtensionPopupAttr)),
                     hasAttribute(AtomicString(kPrivateAttr)));
}

String HTMLWebViewElement::BrowserWindow() const {
  return getAttribute(AtomicString(kWindowAttr));
}

void HTMLWebViewElement::NavigateGuest() {
  if (!guest_.is_bound()) {
    return;
  }
  const AtomicString& source = FastGetAttribute(html_names::kSrcAttr);
  if (source.IsNull()) {
    return;
  }
  // Resolved against this document, like <iframe src>. An invalid URL is still
  // sent so the guest shows an error page, as an <iframe> would.
  guest_->Navigate(
      GetDocument().CompleteURL(StripLeadingAndTrailingHtmlSpaces(source)));
}

void HTMLWebViewElement::SetFocused(bool received,
                                    mojom::blink::FocusType type,
                                    BlurEventBehavior blur_event_behavior) {
  // Logged first and unconditionally, so a log shows whether this ran at all.
  LOG(INFO) << "domicile: <webview> SetFocused received=" << received;

  HTMLFrameElementBase::SetFocused(received, type, blur_event_behavior);
  if (received) {
    // Tell the browser first, so the active tab is updated before shell
    // handlers run. Unbound means no guest yet.
    if (guest_.is_bound()) {
      guest_->Focused();
    }
    DispatchSuppressedFocus(type);
    DispatchGuestFocus();
  }
}

void HTMLWebViewElement::DispatchSuppressedFocus(
    mojom::blink::FocusType type) {
  Page* page = GetDocument().GetPage();
  if (!page || page->GetFocusController().IsFocused()) {
    return;
  }
  LOG(INFO) << "domicile: dispatching the focus a <webview>'s guest took";
  // Stop if a handler moved focus away, as Document's dispatch does.
  DispatchFocusEvent(nullptr, type, nullptr);
  if (GetDocument().FocusedElement() != this) {
    return;
  }
  DispatchEvent(*FocusEvent::Create(event_type_names::kFocusin,
                                    Event::Bubbles::kYes,
                                    GetDocument().domWindow(), 0, nullptr,
                                    nullptr));
}

void HTMLWebViewElement::DispatchGuestFocus() {
  // These two log lines bracket the dispatch so a log separates "never ran"
  // from "ran but the page heard nothing". guard-webview-click.sh reads them.
  LOG(INFO) << "domicile: a <webview>'s guest took focus; announcing it";

  // Synchronous: Document::SetFocusedElement expects SetFocused to dispatch
  // events ("Element::setFocused for frames can dispatch events"), and
  // deferring loses the event.
  //
  // Bubbles so a shell can listen once on the window it drew. See
  // BrowserWindow.tsx in the Domicile repository.
  DispatchEvent(*Event::CreateBubble(AtomicString(kGuestFocusEvent)));

  // Closes the bracket: a missing second line means a handler never returned.
  LOG(INFO) << "domicile: announced a <webview>'s guest focus";
}

LayoutObject* HTMLWebViewElement::CreateLayoutObject(
    const ComputedStyle& style) {
  return MakeGarbageCollected<LayoutIFrame>(this);
}

network::ParsedPermissionsPolicy HTMLWebViewElement::ConstructContainerPolicy()
    const {
  // No `allow` attribute, so no features are delegated, as for an <iframe>
  // with no allow list. Delegating a feature should be an explicit change.
  return network::ParsedPermissionsPolicy();
}

// History controls, sent to the guest in the browser.
//
// Without a guest (the element is not in a document yet) they do nothing, as
// NavigateGuest does.
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

// Does not set `zoom_`: the browser's result may differ (e.g. another window
// on the site zooms), so only ZoomChanged updates it.
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

// Results come from the browser, which counts across frames this renderer
// cannot see. Does nothing without a guest.
void HTMLWebViewElement::find(const String& text, bool backward) {
  if (guest_.is_bound()) {
    if (text.empty()) {
      // Empty text ends the find; content cannot search for nothing. See
      // WebViewGuest.Find.
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

// A no-op with no guest, like the history controls.
void HTMLWebViewElement::inspect() {
  if (guest_.is_bound()) {
    guest_->Inspect();
  }
}

// Only the guest dispatches menus, so a guest exists here.
void HTMLWebViewElement::RunContextMenuAction(
    const DomicileContextMenuEvent& menu,
    domicile::mojom::blink::WebViewContextMenuAction action,
    ExceptionState& exception_state) {
  if (menu.id() != context_menu_id_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "A newer context menu has replaced this one.");
    return;
  }
  CHECK(guest_.is_bound());
  // Edits act on the focused element, but the shell's menu has focus. Refocus
  // the page first; the browser waits for it (WebViewGuest::EditWhenFocused).
  if (IsEdit(action)) {
    // Qualified: a frame owner's Focus(const FocusParams&) override hides the
    // no-argument overload.
    Element::Focus();
  }
  guest_->RunContextMenuAction(menu.id(), action);
}

// State updates store the new value before dispatching, so handlers read it.
void HTMLWebViewElement::HistoryChanged(bool can_go_back, bool can_go_forward) {
  can_go_back_ = can_go_back;
  can_go_forward_ = can_go_forward;

  // Bubbles, like the focus event.
  DispatchEvent(*Event::CreateBubble(AtomicString(kHistoryChangeEvent)));
}

void HTMLWebViewElement::LoadingChanged(bool is_loading) {
  loading_ = is_loading;

  DispatchEvent(*Event::CreateBubble(AtomicString(kLoadingChangeEvent)));
}

void HTMLWebViewElement::PageChanged(
    const KURL& url,
    domicile::mojom::blink::WebViewSecurity security) {
  // Set both before dispatching, so a handler never sees a new URL with the
  // old security level.
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

void HTMLWebViewElement::ZoomChanged(double factor) {
  zoom_ = factor;

  DispatchEvent(*Event::CreateBubble(AtomicString(kZoomChangeEvent)));
}

void HTMLWebViewElement::FaviconChanged(const KURL& icon) {
  favicon_ = icon.IsValid() ? icon.GetString() : String("");

  DispatchEvent(*Event::CreateBubble(AtomicString(kFaviconChangeEvent)));
}

void HTMLWebViewElement::FindChanged(int32_t matches, int32_t active_match) {
  find_matches_ = matches;
  find_active_match_ = active_match;

  DispatchEvent(*Event::CreateBubble(AtomicString(kFindChangeEvent)));
}

void HTMLWebViewElement::ContentSizeChanged(int32_t width, int32_t height) {
  content_width_ = width;
  content_height_ = height;

  DispatchEvent(*Event::CreateBubble(AtomicString(kContentSizeChangeEvent)));
}

void HTMLWebViewElement::ZoomRequested(bool zoom_in) {
  DispatchEvent(*Event::CreateBubble(
      AtomicString(zoom_in ? kZoomInRequestEvent : kZoomOutRequestEvent)));
}

// Held in `waiting_choosers_` until answered. If no listener calls
// `preventDefault()`, the shell has no picker, so cancel immediately.
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

// Stored before dispatch, so a handler can run the menu immediately.
void HTMLWebViewElement::ContextMenuRequested(
    domicile::mojom::blink::WebViewContextMenuPtr menu) {
  context_menu_id_ = menu->id;
  DispatchEvent(*MakeGarbageCollected<DomicileContextMenuEvent>(
      AtomicString(kContextMenuEvent), std::move(menu), *this));
}

// Bubbles, like the state events.
void HTMLWebViewElement::CloseRequested() {
  DispatchEvent(*Event::CreateBubble(AtomicString(kCloseEvent)));
}

// Bubbles, like CloseRequested.
void HTMLWebViewElement::FocusRequested() {
  DispatchEvent(*Event::CreateBubble(AtomicString(kFocusRequestEvent)));
}

void HTMLWebViewElement::FileChooserAnswered(DomicileFileChooserEvent& event) {
  waiting_choosers_.erase(&event);
}

}  // namespace blink
