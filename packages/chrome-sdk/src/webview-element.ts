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
 * The attribute that makes a `<webview>` show a browser window:
 * `<webview window="1">` shows the window whose `DomicileBrowserWindow.id` is
 * `"1"`.
 *
 * - **Lifetime:** the engine holds the page, so it outlives the shell's
 *   document. After `domicile load-shell` the next shell draws the same pages,
 *   with scroll, form input and history intact. A `<webview src>` page belongs
 *   to the document and goes with it.
 * - **Read once,** when the element is inserted. Set it before inserting the
 *   view; later changes do nothing.
 * - **`src`:** ignored on insert, since the page is already loaded. A later
 *   `src` navigates the window.
 * - **One view per window.** A second view of the same window is empty.
 * - **Opening:** `target="_blank"`, `window.open`, `domicile open-url`,
 *   `chrome.tabs.create` and `chrome.windows.create` open windows without the
 *   shell. They appear in `DomicileHost.browserWindows`. The shell's own UI
 *   opens one with `DomicileHost.openBrowserWindow`.
 */
export const WEBVIEW_WINDOW_ATTRIBUTE = "window";

/**
 * Fired when the page calls `window.close()`, or an extension's
 * `chrome.tabs.remove` names the view. The shell should remove the view.
 * Bubbles.
 *
 * Fired only on a view without {@link WEBVIEW_WINDOW_ATTRIBUTE}. A browser
 * window closes in the browser instead and leaves
 * `DomicileHost.browserWindows`.
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
 * Fired when {@link HTMLWebViewElement.targetUrl} changes. Carries no payload.
 * Bubbles.
 */
export const WEBVIEW_TARGET_URL_CHANGE_EVENT = "domicile-target-url-change";

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
 * Fired when {@link HTMLWebViewElement.pageFullscreen} changes. Carries no
 * payload. Bubbles.
 */
export const WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT =
  "domicile-page-fullscreen-change";

/**
 * Fired when the page needs a file picked: an `<input type="file">` or a
 * download. Bubbles.
 *
 * The browser draws no dialog. Call `preventDefault()` to handle it, then
 * answer with {@link DomicileFileChooserEvent.choose} or
 * {@link DomicileFileChooserEvent.cancel}. If no listener calls
 * `preventDefault()`, the request is canceled, so uploads and downloads fail.
 * Every download asks for a path. A picker lists directories with `readDir`
 * from `@domicile-desktop/sdk/system`.
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
 * Fired on a right click the page did not `preventDefault`. Bubbles.
 *
 * The browser draws no context menu. The event carries what was under the
 * click, so the shell can draw one. {@link DomicileContextMenuEvent.run} does
 * the browser's part of an item. A newer menu replaces this one, after which
 * `run()` throws.
 */
export const WEBVIEW_CONTEXT_MENU_EVENT = "domicile-context-menu";

/**
 * What {@link DomicileContextMenuEvent.run} can do.
 *
 * - Edit commands on the focused element: `undo`, `redo`, `cut`, `copy`,
 *   `paste`, `paste-and-match-style`, `delete`, `select-all`.
 * - Over a link: `copy-link-address`, `save-link-as`.
 * - Over an image with pixels, or a canvas: `copy-image`.
 * - Over an image, video or audio: `copy-media-address`, `save-media-as`.
 * - Anywhere: `inspect`, DevTools on the element under the click.
 *
 * A save asks {@link WEBVIEW_FILE_CHOOSER_EVENT} where.
 */
export const WEBVIEW_CONTEXT_MENU_ACTIONS = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "paste-and-match-style",
  "delete",
  "select-all",
  "copy-link-address",
  "save-link-as",
  "copy-image",
  "copy-media-address",
  "save-media-as",
  "inspect",
] as const;

export type WebViewContextMenuAction =
  (typeof WEBVIEW_CONTEXT_MENU_ACTIONS)[number];

/** What was under the click: {@link DomicileContextMenuEvent.mediaType}. */
export const WEBVIEW_MEDIA_TYPES = [
  "none",
  "image",
  "video",
  "audio",
  "canvas",
  "file",
  "plugin",
] as const;

export type WebViewMediaType = (typeof WEBVIEW_MEDIA_TYPES)[number];

/**
 * Fired when the page asks for a permission its site has no stored choice
 * for, such as the camera in a video call. Bubbles.
 *
 * The browser draws no prompt. Call `preventDefault()` to handle it, then
 * answer with {@link DomicilePermissionRequestEvent.allow},
 * {@link DomicilePermissionRequestEvent.deny} or
 * {@link DomicilePermissionRequestEvent.dismiss}. If no listener calls
 * `preventDefault()`, the request is ignored: the page gets nothing and
 * nothing is stored. One request is outstanding at a time.
 */
export const WEBVIEW_PERMISSION_REQUEST_EVENT = "domicile-permission-request";

/**
 * Fired when the browser drops the outstanding
 * {@link WEBVIEW_PERMISSION_REQUEST_EVENT} unanswered, for example because the
 * page navigated. Answering it afterward throws. Carries no payload. Bubbles.
 */
export const WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT =
  "domicile-permission-request-withdrawn";

/**
 * Fired when {@link HTMLWebViewElement.sitePermissions} may have changed: the
 * page moved to another site, or a setting changed. Carries no payload.
 * Bubbles.
 */
export const WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT =
  "domicile-site-permissions-change";

/**
 * The permissions a site can ask for and a shell can set.
 *
 * - `camera`, `microphone`: `getUserMedia`.
 * - `location`: the Geolocation API.
 * - `notifications`: allowed by default (see `NOTIFICATIONS.md`).
 * - `clipboard`: reading the clipboard.
 * - `midi`: Web MIDI with system exclusive messages.
 */
export const WEBVIEW_PERMISSIONS = [
  "camera",
  "microphone",
  "location",
  "notifications",
  "clipboard",
  "midi",
] as const;

export type WebViewPermission = (typeof WEBVIEW_PERMISSIONS)[number];

/** A site's stored choice for a permission. `ask` prompts the shell. */
export const WEBVIEW_PERMISSION_SETTINGS = ["ask", "allow", "block"] as const;

export type WebViewPermissionSetting =
  (typeof WEBVIEW_PERMISSION_SETTINGS)[number];

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
     * The address of the link under the pointer, or `""` if none, for a status
     * bubble like Chrome's. Changes fire {@link WEBVIEW_TARGET_URL_CHANGE_EVENT}.
     */
    readonly targetUrl: string;
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
    /**
     * Whether the page is fullscreen, as a video's fullscreen button makes it.
     * The page fills the view's box; the shell grows the view to fill the
     * screen. Escape in the page ends it. Changes fire
     * {@link WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT}.
     */
    readonly pageFullscreen: boolean;
    /** Take the page out of fullscreen, as Escape does. */
    exitPageFullscreen(): void;
    /**
     * Open DevTools for the page in a new browser window. If DevTools is
     * already open, the view showing it fires
     * {@link WEBVIEW_FOCUS_REQUEST_EVENT} instead.
     */
    inspect(): void;
    /**
     * The page's site's setting for each of {@link WEBVIEW_PERMISSIONS}, or
     * `{}` for a page that is not `http`, `https` or `chrome-extension`.
     * Changes fire {@link WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT}.
     *
     * Keys and values are external data; parse them at the boundary.
     */
    sitePermissions(): Record<string, string>;
    /**
     * Store `setting` for `permission` on the page's site. The result fires
     * {@link WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT}. Throws a `TypeError` for
     * an unknown name, and an `InvalidStateError` when
     * {@link HTMLWebViewElement.sitePermissions} is empty.
     */
    setSitePermission(
      permission: WebViewPermission,
      setting: WebViewPermissionSetting,
    ): void;
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
   * The {@link WEBVIEW_CONTEXT_MENU_EVENT} event. The engine defines it in
   * `domicile_context_menu_event.idl`.
   */
  interface DomicileContextMenuEvent extends Event {
    /** The click, in CSS pixels from the view's top left. */
    readonly x: number;
    readonly y: number;
    /** The absolute link address, or `""` for none. */
    readonly linkUrl: string;
    readonly linkText: string;
    /** The absolute image, video or audio address, or `""` for none. */
    readonly srcUrl: string;
    /**
     * One of {@link WEBVIEW_MEDIA_TYPES}. A `string` because it is external
     * data; parse it at the boundary.
     */
    readonly mediaType: string;
    /** Whether an image has pixels to copy. A broken image has none. */
    readonly hasImageContents: boolean;
    /** The selected text, or `""`. */
    readonly selectionText: string;
    /** Whether the click was in an editable element. */
    readonly isEditable: boolean;
    /** What the page reports can be done where the click was. */
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
    readonly canDelete: boolean;
    readonly canSelectAll: boolean;
    /**
     * Do one of {@link WEBVIEW_CONTEXT_MENU_ACTIONS} for this menu. Throws a
     * `TypeError` for an unknown action, a `NotSupportedError` for one this
     * menu does not offer (a link action with no link), and an
     * `InvalidStateError` once a newer menu has replaced this one.
     */
    run(action: WebViewContextMenuAction): void;
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
    /** Answer that nothing was picked. */
    cancel(): void;
  }

  /**
   * The {@link WEBVIEW_PERMISSION_REQUEST_EVENT} event. The engine defines it
   * in `domicile_permission_request_event.idl`.
   */
  interface DomicilePermissionRequestEvent extends Event {
    /** The asking site's origin, such as `https://meet.google.com`. */
    readonly origin: string;
    /**
     * What it asks for, from {@link WEBVIEW_PERMISSIONS}. Camera and
     * microphone may come together. `string`s because they are external data;
     * parse them at the boundary.
     */
    readonly permissions: readonly string[];
    /**
     * Allow or block the site, storing the choice, or close without choosing.
     * Answering twice, or after
     * {@link WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT}, throws an
     * `InvalidStateError`.
     */
    allow(): void;
    deny(): void;
    dismiss(): void;
  }

  /**
   * Types `addEventListener` for the events that carry data. Merged into
   * `HTMLElementEventMap` because `HTMLWebViewElement` has no event map of its
   * own.
   */
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementEventMap {
    "domicile-guest-keydown": KeyboardEvent;
    "domicile-file-chooser": DomicileFileChooserEvent;
    "domicile-context-menu": DomicileContextMenuEvent;
    "domicile-permission-request": DomicilePermissionRequestEvent;
  }
}
