// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_

#include <cstdint>
#include <optional>

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/html_frame_element_base.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_receiver.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_hash_set.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"
#include "third_party/blink/renderer/platform/weborigin/kurl.h"

namespace blink {

class DomicileContextMenuEvent;
class DomicileFileChooserEvent;
class ExceptionState;

// <webview>: a browser page embedded in a shell, driven by `src`, goBack(),
// goForward(), stop() and reload(). Defined by the fork because a custom
// element's name needs a hyphen.
//
// The element owns a placeholder frame that stays on about:blank. `src` goes
// to the browser over WebViewGuestHost, which attaches a guest WebContents to
// that frame. A guest's main frame passes X-Frame-Options and CSP
// frame-ancestors; see components/domicile/browser/web_view_guest.h.
//
// Known gap: `srcdoc` is not intercepted, so setting it would navigate the
// placeholder frame. The IDL has no srcdoc and nothing sets it.
class CORE_EXPORT HTMLWebViewElement final
    : public HTMLFrameElementBase,
      public domicile::mojom::blink::WebViewGuestClient {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLWebViewElement(Document&);
  ~HTMLWebViewElement() override;

  // Required for `DynamicTo` and `IsA`: without it every downcast returns null
  // and nothing else fails. See node.h and
  // scripts/test-fork-elements-know-their-type.sh.
  ElementType GetElementType() const final {
    return ElementType::kHTMLWebViewElement;
  }

  // Address bar controls. They act on the guest's history in the browser, not
  // on the placeholder frame's.
  //
  // They never throw: the pipe lives as long as the element, and going back
  // with no history is a no-op.
  void goBack();
  void goForward();
  void stop();
  void reload();

  // Whether goBack() and goForward() would navigate, for graying out buttons.
  //
  // Properties, so a shell that mounts late can read the current state;
  // `domicile-history-change` only signals a change. Not content attributes,
  // which authors could overwrite. The browser pushes the values (see
  // WebViewGuestClient in components/domicile/mojom/web_view_guest.mojom) so
  // reading them never blocks.
  bool canGoBack() const { return can_go_back_; }
  bool canGoForward() const { return can_go_forward_; }

  // Whether a browser would show a loading spinner. A property, like
  // canGoBack. Combines `IsLoading()` with `should_show_loading_ui`, so
  // same-document navigations do not count. See WebViewGuest::ReportLoading.
  bool loading() const { return loading_; }

  // The page's current URL and security level, for an address bar. Both come
  // from the same navigation entry in one message, so they always match.
  // Properties, like canGoBack.
  //
  // Empty means the browser has not reported yet (the initial entry). Do not
  // read it as any security level.
  const String& url() const { return url_; }
  const String& security() const { return security_; }

  double zoom() const { return zoom_; }

  // The page's icon, or empty. See FaviconChanged in
  // components/domicile/mojom/web_view_guest.mojom.
  const String& favicon() const { return favicon_; }
  void setZoom(double factor, ExceptionState&);

  // Find in page. The browser searches the guest; results arrive in
  // FindChanged.
  void find(const String& text, bool backward);
  void stopFinding();
  int32_t findMatches() const { return find_matches_; }
  int32_t findActiveMatch() const { return find_active_match_; }

  // The content's preferred size, from ContentSizeChanged.
  int32_t contentWidth() const { return content_width_; }
  int32_t contentHeight() const { return content_height_; }

  // Opens DevTools on the guest's page. See WebViewGuest.Inspect.
  void inspect();

  // Runs `action` for `menu`. Throws InvalidStateError if a newer menu has
  // replaced it. See domicile_context_menu_event.h.
  void RunContextMenuAction(
      const DomicileContextMenuEvent& menu,
      domicile::mojom::blink::WebViewContextMenuAction action,
      ExceptionState&);

  // Releases a dispatched file chooser event once answered. See
  // `waiting_choosers_`.
  void FileChooserAnswered(DomicileFileChooserEvent&);

  void Trace(Visitor*) const override;

 private:
  /**
   * Dispatches an event when this element gains focus, so the shell can raise
   * the window.
   *
   * A guest taking focus unfocuses the embedder's page first
   * (WebContentsImpl::SetFocusedFrameTree), and Document::SetFocusedElement
   * skips `focus` and `focusin` on an unfocused page. Without this, a click in
   * a browser window would produce no event. guard-webview-click.sh checks
   * this.
   *
   * Overrides SetFocused because Document::SetFocusedElement always calls it,
   * whatever route focus took. Patch 0011 makes the base's SetFocused callable
   * from a subclass.
   */
  void SetFocused(bool received,
                  mojom::blink::FocusType,
                  BlurEventBehavior) override;

  /**
   * Dispatches the focus event synchronously. Deferring it (by queue or task)
   * loses the event. Document::SetFocusedElement allows frames to dispatch
   * events from SetFocused. Logs before and after for diagnosis.
   */
  void DispatchGuestFocus();

  /**
   * Dispatches the `focus` and `focusin` that Document::SetFocusedElement
   * skipped because the embedder's page is unfocused. Only then: a focused
   * page already got them.
   *
   * Upstream defers them until the page regains focus, but here the page lost
   * focus to its own guest, so focus-out handlers and React's onFocus would
   * see stale focus. The matching `blur` and `focusout` already fired in
   * FocusController::FocusHasChanged.
   *
   * Dispatched directly, not via Element::DispatchFocusInEvent, which may
   * queue on a ScopedEventQueue and lose the event. guard-webview-click.sh
   * checks this.
   */
  void DispatchSuppressedFocus(mojom::blink::FocusType);

  LayoutObject* CreateLayoutObject(const ComputedStyle&) override;

  // `src` never reaches HTMLFrameElementBase, which would navigate the
  // placeholder frame. Everything else does.
  void ParseAttribute(const AttributeModificationParams&) override;

  // The base creates the about:blank placeholder frame here, so this is the
  // earliest point to request a guest.
  void DidNotifySubtreeInsertionsToDocument() override;

  // Requests a guest for the placeholder frame. Does nothing if there already
  // is one or there is no placeholder yet.
  void RequestGuest();

  // Sends the current `src` to the guest. Safe before the attach finishes.
  void NavigateGuest();

  // kIframe, not a new value: everything that switches on owner type should
  // treat this like an <iframe>, and a new value in this //content enum would
  // touch every such switch.
  FrameOwnerElementType OwnerType() const final {
    return FrameOwnerElementType::kIframe;
  }

  network::ParsedPermissionsPolicy ConstructContainerPolicy() const override;

  // domicile::mojom::blink::WebViewGuestClient:
  //
  // The browser sends these only on change, so each dispatches its event
  // unconditionally.
  void HistoryChanged(bool can_go_back, bool can_go_forward) override;
  void LoadingChanged(bool is_loading) override;
  void PageChanged(const KURL& url,
                   domicile::mojom::blink::WebViewSecurity security) override;

  // Dispatches a chord the page did not handle as a KeyboardEvent on this
  // element. See UnhandledKeyDown in
  // components/domicile/mojom/web_view_guest.mojom.
  void UnhandledKeyDown(const String& key,
                        const String& code,
                        bool alt_key,
                        bool ctrl_key,
                        bool shift_key,
                        bool meta_key,
                        bool repeat) override;

  void ZoomChanged(double factor) override;

  void ZoomRequested(bool zoom_in) override;

  void FaviconChanged(const KURL& icon) override;

  // Sent only on change, like HistoryChanged.
  void FindChanged(int32_t matches, int32_t active_match) override;
  void ContentSizeChanged(int32_t width, int32_t height) override;

  // Dispatches `domicile-file-chooser` for the shell to answer. If no listener
  // calls `preventDefault()`, the chooser is canceled after dispatch. See
  // domicile_file_chooser_event.h.
  void FileChooserRequested(
      domicile::mojom::blink::WebViewFileChooserMode mode,
      const Vector<String>& accept,
      const String& suggested_name,
      const String& home,
      FileChooserRequestedCallback callback) override;

  // Dispatches `domicile-context-menu`. See domicile_context_menu_event.h.
  void ContextMenuRequested(
      domicile::mojom::blink::WebViewContextMenuPtr menu) override;

  // Dispatches `domicile-close` when the page called window.close(); the shell
  // removes the element. Only for elements without `window`, since the browser
  // closes browser windows itself.
  void CloseRequested() override;

  // Dispatches `domicile-focus-request` when an extension asks to raise this
  // window. The shell decides window order.
  void FocusRequested() override;

  // The `window` attribute for CreateGuest, or a null String if absent.
  String BrowserWindow() const;

  // Kept open for the element's life: the browser may hold the request on
  // this pipe until the placeholder frame arrives. See WebViewGuestHost in
  // components/domicile/browser/web_view_guest.cc.
  HeapMojoRemote<domicile::mojom::blink::WebViewGuestHost> host_;

  // Bound once. A later `src` reuses it, since the attach destroys the
  // placeholder frame a second request would need.
  HeapMojoRemote<domicile::mojom::blink::WebViewGuest> guest_;

  // Passed in CreateGuest, so the browser always has somewhere to report.
  HeapMojoReceiver<domicile::mojom::blink::WebViewGuestClient,
                   HTMLWebViewElement>
      client_receiver_;

  // The browser's last reports. Defaults match a fresh guest, for which the
  // browser sends nothing. `security_` is empty, not "neutral", until the
  // browser reports one.
  bool can_go_back_ = false;
  bool can_go_forward_ = false;
  bool loading_ = false;
  String url_;
  String security_;
  double zoom_ = 1.0;
  String favicon_;
  int32_t find_matches_ = 0;
  int32_t find_active_match_ = 0;
  int32_t content_width_ = 0;
  int32_t content_height_ = 0;

  // The newest context menu dispatched; the browser acts only on it. 0 before
  // the first.
  int32_t context_menu_id_ = 0;

  // File chooser events the shell has not answered yet.
  //
  // Held so garbage collection cannot destroy the browser's reply callback
  // unrun, which would leave the page waiting forever.
  HeapHashSet<Member<DomicileFileChooserEvent>> waiting_choosers_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_WEB_VIEW_ELEMENT_H_
