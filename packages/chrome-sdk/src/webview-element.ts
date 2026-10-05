// Types and event names for the engine's `<webview>` element, which shows web
// content in its own browsing context.
//
// The engine implements the element and dispatches every event below. This
// module only declares them for TypeScript. See
// `docs/architecture/BROWSER-WINDOWS.md`.

/**
 * Fired when the page inside the view takes focus, for example on a click.
 *
 * Use it to raise the window: pointer events inside the guest do not reach the
 * shell. The view also gets real `focus` and `focusin` events. Bubbles. See
 * `HTMLWebViewElement::GuestTookFocus` in the engine.
 */
export const WEBVIEW_GUEST_FOCUS_EVENT = "domicile-guest-focus";

/**
 * Fired when {@link HTMLWebViewElement.canGoBack} or
 * {@link HTMLWebViewElement.canGoForward} may have changed.
 *
 * Carries no payload. Read the properties instead, since a shell that mounts
 * late misses earlier events. Bubbles.
 */
export const WEBVIEW_HISTORY_CHANGE_EVENT = "domicile-history-change";

/**
 * Fired when {@link HTMLWebViewElement.loading} changes.
 *
 * Carries no payload. Fires once per start and stop, not per subresource.
 * Same-document navigations (fragments, `pushState`) do not fire it. Bubbles.
 */
export const WEBVIEW_LOADING_CHANGE_EVENT = "domicile-loading-change";

/**
 * Fired when {@link HTMLWebViewElement.url} or
 * {@link HTMLWebViewElement.security} changes. Carries no payload. Bubbles.
 *
 * Always show `security` with `url`, never with `src`. The engine updates both
 * from the same navigation entry; pairing the lock with another address
 * enables address-bar spoofing. See
 * `components/domicile/mojom/web_view_guest.mojom`.
 */
export const WEBVIEW_PAGE_CHANGE_EVENT = "domicile-page-change";

/**
 * The connection security levels a `<webview>` can report.
 *
 * Derived from `security_state::GetSecurityLevel`, as Chrome's omnibox lock
 * is. An `https://` page with a bad certificate or active mixed content is
 * `dangerous`.
 *
 * The element reports `""` before the first navigation commits. Do not treat
 * it as `neutral`; see `connection-safety.ts` in shell-manganese.
 */
export const WEBVIEW_SECURITY_LEVELS = [
  "neutral",
  "secure",
  "warning",
  "dangerous",
] as const;

export type WebViewSecurity = (typeof WEBVIEW_SECURITY_LEVELS)[number];

/**
 * Fired when the page asks for a new window: `target="_blank"`,
 * `window.open`, or a form aimed at a missing named target. Bubbles.
 *
 * The shell should open a new browser window at
 * {@link DomicileNewWindowEvent.url}. The browser refuses to create the window
 * itself, because a guest without its own `SiteInstance` would hit a `CHECK`
 * in `WebContentsImpl::CreateNewWindow`.
 *
 * The new window is a plain navigation, so `window.open()` returns `null`, the
 * opener and `window.name` are lost, and a POST becomes a GET. Links work
 * fully.
 */
export const WEBVIEW_NEW_WINDOW_EVENT = "domicile-new-window";

/**
 * Fired when an extension calls `chrome.windows.create({type: "popup", url})`,
 * such as an extension's "pop out". Dispatched on the most recently used view.
 * Bubbles.
 *
 * The shell should open a browser window whose `<webview>` has `popupwindow`
 * set to {@link DomicilePopupWindowEvent.windowId}. Set the attribute before
 * inserting the view: the engine reads it only once.
 *
 * Afterward, `chrome.windows.remove(id)` fires {@link WEBVIEW_CLOSE_EVENT} on
 * the view and `chrome.windows.update(id, {focused: true})` fires
 * {@link WEBVIEW_FOCUS_REQUEST_EVENT}. See
 * `docs/architecture/EXTENSIONS.md`.
 */
export const WEBVIEW_POPUP_WINDOW_EVENT = "domicile-popup-window";

/**
 * Fired when the page calls `window.close()`. The shell should remove the
 * view. Bubbles.
 *
 * Fires only for script-closable pages (one history entry), per the HTML spec.
 * Extension popups close this way.
 */
export const WEBVIEW_CLOSE_EVENT = "domicile-close";

/**
 * Fired when the page calls `window.focus()` or `client.focus()` (how a site
 * answers a click on its notification), or when an extension calls
 * `chrome.tabs.update(id, {active: true})` or
 * `chrome.windows.update(id, {focused: true})` for this view. The shell should
 * raise and focus it. Bubbles.
 */
export const WEBVIEW_FOCUS_REQUEST_EVENT = "domicile-focus-request";

/**
 * A `KeyboardEvent` fired for a Ctrl, Alt or Meta chord the page did not
 * `preventDefault`. Bubbles.
 *
 * Guest keys never reach the shell's document, so this is how a shell sees
 * them. The page handles the key first, as in Chrome. It is not named
 * `keydown` so existing `keydown` listeners do not see it. Plain keys are
 * never forwarded, so typed text such as passwords stays in the guest.
 */
export const WEBVIEW_GUEST_KEYDOWN_EVENT = "domicile-guest-keydown";

/**
 * Fired when {@link HTMLWebViewElement.zoom} changes. Carries no payload.
 * Bubbles.
 *
 * Zoom is per host, as in Chrome, so another window on the same site or a
 * navigation can also change it.
 */
export const WEBVIEW_ZOOM_CHANGE_EVENT = "domicile-zoom-change";

/**
 * Fired when {@link HTMLWebViewElement.favicon} changes. Carries no payload.
 * Bubbles.
 */
export const WEBVIEW_FAVICON_CHANGE_EVENT = "domicile-favicon-change";

/**
 * Fired on Ctrl+wheel over a page that did not handle the wheel.
 *
 * The engine does not zoom; the shell picks the step and calls `setZoom`, so
 * the wheel and keyboard shortcuts share one path. Two plain `Event`s instead
 * of one with a direction. Both bubble.
 */
export const WEBVIEW_ZOOM_IN_REQUEST_EVENT = "domicile-zoom-in-request";
export const WEBVIEW_ZOOM_OUT_REQUEST_EVENT = "domicile-zoom-out-request";

/**
 * Fired when {@link HTMLWebViewElement.findMatches} or
 * {@link HTMLWebViewElement.findActiveMatch} changes. Carries no payload.
 * Bubbles.
 *
 * Fires several times as frames are searched. Navigation ends the find and
 * resets the counts, as in Chrome.
 */
export const WEBVIEW_FIND_CHANGE_EVENT = "domicile-find-change";

/**
 * Fired when {@link HTMLWebViewElement.contentWidth} or
 * {@link HTMLWebViewElement.contentHeight} changes. Carries no payload.
 * Bubbles.
 */
export const WEBVIEW_CONTENT_SIZE_CHANGE_EVENT = "domicile-content-size-change";

/**
 * Fired when the page needs a file picked: an `<input type="file">` or a
 * download. Bubbles.
 *
 * The browser draws no dialog. Call `preventDefault()` to handle it, then
 * answer with {@link DomicileFileChooserEvent.choose} or
 * {@link DomicileFileChooserEvent.cancel}. If no listener calls
 * `preventDefault()`, the request is canceled, so uploads and downloads fail.
 * Every download asks for a path.
 */
export const WEBVIEW_FILE_CHOOSER_EVENT = "domicile-file-chooser";

/**
 * What a {@link WEBVIEW_FILE_CHOOSER_EVENT} asks for.
 *
 * - `open`: one existing file.
 * - `open-multiple`: one or more existing files.
 * - `open-folder`: one existing directory, whose contents the browser reads.
 * - `save`: one path to write, which need not exist yet.
 */
export const WEBVIEW_FILE_CHOOSER_MODES = [
  "open",
  "open-multiple",
  "open-folder",
  "save",
] as const;

export type WebViewFileChooserMode =
  (typeof WEBVIEW_FILE_CHOOSER_MODES)[number];

/**
 * Global declarations for the engine's `<webview>`.
 *
 * Merged into the global `HTMLWebViewElement` because `@types/react` already
 * declares an empty one for JSX `ref`s. A separate exported type would not be
 * assignable to it. The engine ships no `.d.ts`, so the interface is written
 * out here.
 */
declare global {
  // An `interface` so it can merge with existing declarations.
  interface HTMLWebViewElement extends HTMLElement {
    /** The address to load. Reflects the `src` attribute. */
    src: string;
    /** Whether {@link HTMLWebViewElement.goBack} would navigate. */
    readonly canGoBack: boolean;
    /** Whether {@link HTMLWebViewElement.goForward} would move the page. */
    readonly canGoForward: boolean;
    /**
     * Whether the page is loading. Changes fire
     * {@link WEBVIEW_LOADING_CHANGE_EVENT}.
     */
    readonly loading: boolean;
    /**
     * The current address, as a browser's address bar shows it. Differs from
     * {@link HTMLWebViewElement.src} after links and redirects.
     *
     * `""` until the first navigation commits. Changes fire
     * {@link WEBVIEW_PAGE_CHANGE_EVENT}.
     */
    readonly url: string;
    /**
     * The connection security of {@link HTMLWebViewElement.url}: one of
     * {@link WEBVIEW_SECURITY_LEVELS}, or `""` before the first commit.
     *
     * Typed as `string` because it is external data; parse it into
     * {@link WebViewSecurity}.
     */
    readonly security: string;
    /**
     * The zoom factor, where 1 is 100%. Changes fire
     * {@link WEBVIEW_ZOOM_CHANGE_EVENT}.
     */
    readonly zoom: number;
    /**
     * Set the zoom factor. Throws a `RangeError` outside 0.25 to 5. The result
     * fires {@link WEBVIEW_ZOOM_CHANGE_EVENT}.
     */
    setZoom(factor: number): void;
    /**
     * The page's best linked icon (SVG first, then largest) as an absolute
     * URL, or `""` if none. Changes fire {@link WEBVIEW_FAVICON_CHANGE_EVENT}.
     */
    readonly favicon: string;
    /**
     * Find `text` and select the next match, or the previous one when
     * `backward` is true. Repeating the same text steps through matches; `""`
     * ends the find and clears the selection. Results fire
     * {@link WEBVIEW_FIND_CHANGE_EVENT}.
     */
    find(text: string, backward?: boolean): void;
    /** End the find, keeping the current match selected. */
    stopFinding(): void;
    /** The match count across all frames, or 0 with no active find. */
    readonly findMatches: number;
    /** The 1-based index of the selected match, or 0 if none. */
    readonly findActiveMatch: number;
    /**
     * The content's preferred size in CSS pixels: max-content width and
     * document height at the current width. Used to size extension popups.
     * Cap the width, since text can make it very wide. Both 0 before layout.
     * Changes fire {@link WEBVIEW_CONTENT_SIZE_CHANGE_EVENT}.
     */
    readonly contentWidth: number;
    readonly contentHeight: number;
    goBack(): void;
    goForward(): void;
    stop(): void;
    reload(): void;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementTagNameMap {
    webview: HTMLWebViewElement;
  }

  /**
   * The {@link WEBVIEW_NEW_WINDOW_EVENT} event. The engine defines it in
   * `third_party/blink/renderer/core/html/domicile/domicile_new_window_event.idl`.
   */
  interface DomicileNewWindowEvent extends Event {
    /** The absolute address to open. */
    readonly url: string;
  }

  /**
   * The {@link WEBVIEW_POPUP_WINDOW_EVENT} event. The engine defines it in
   * `domicile_popup_window_event.idl`.
   */
  interface DomicilePopupWindowEvent extends Event {
    /**
     * The extension's `chrome.windows` id. Set the view's `popupwindow`
     * attribute to it, in decimal.
     */
    readonly windowId: number;
    /** The address to show, absolute. */
    readonly url: string;
    /**
     * The requested outer window size in CSS pixels, or 0 on an unspecified
     * axis.
     */
    readonly width: number;
    readonly height: number;
  }

  /**
   * The {@link WEBVIEW_FILE_CHOOSER_EVENT} event.
   *
   * Paths are absolute or relative to home, where `""` is home. A path
   * containing `..` throws a `TypeError`.
   */
  interface DomicileFileChooserEvent extends Event {
    /**
     * One of {@link WEBVIEW_FILE_CHOOSER_MODES}. A `string` because it is
     * external data; parse it at the boundary.
     */
    readonly mode: string;
    /**
     * Accepted file extensions, lowercase without the dot. MIME types such as
     * `image/*` are already expanded. Empty means any file.
     */
    readonly accept: readonly string[];
    /** The name the page suggests for a `save`; `""` otherwise. */
    readonly suggestedName: string;
    /** The absolute home directory, where a picker starts. */
    readonly home: string;
    /**
     * Answer with the picked paths. `open-multiple` takes one or more; other
     * modes take exactly one. Otherwise throws a `TypeError`. Answering twice
     * throws an `InvalidStateError`.
     */
    choose(paths: readonly string[]): void;
    /**
     * The unordered entries of the directory at `path`, with directories
     * ending in `/`. Rejects with `NotReadableError` if `path` is not a
     * readable directory, and with `InvalidStateError` after an answer.
     */
    list(path: string): Promise<string[]>;
    /** Answer that nothing was picked. */
    cancel(): void;
  }

  /**
   * Types `addEventListener` for the events that carry data. Merged into
   * `HTMLElementEventMap` because `HTMLWebViewElement` has no event map of its
   * own.
   */
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementEventMap {
    "domicile-new-window": DomicileNewWindowEvent;
    "domicile-popup-window": DomicilePopupWindowEvent;
    "domicile-guest-keydown": KeyboardEvent;
    "domicile-file-chooser": DomicileFileChooserEvent;
  }
}
