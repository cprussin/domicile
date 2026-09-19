// The fork's `<webview>`: web content in a browsing context of its own.
//
// There is no code here, and that is the point. The element belongs to the
// engine — `src`, the four history controls and the three state properties are
// all `HTMLWebViewElement`'s, and the events below are dispatched by the
// browser process rather than by anything in this package. What is left for the
// SDK to say is the part TypeScript cannot read off the fork: what the tag is,
// and what the engine calls the three events it fires on it.
//
// It used to be a `<domicile-webview>` custom element wrapping one of these,
// because a custom element's name must contain a hyphen and the SDK predates
// the fork. The wrapper forwarded every call above straight through, so
// nothing is lost by writing the tag itself.

/**
 * Fired when the page inside the view takes focus — a click in it, anywhere.
 *
 * THE ENGINE DISPATCHES THIS, and the name is the contract between it and a
 * shell: the page in the view is a guest with a browsing context of its own, so
 * no pointer event inside it crosses back out, and the focus it takes cannot
 * cross either — `Document::SetFocusedElement` dispatches `focus` and `focusin`
 * only while the page is focused, and a guest taking focus is the moment the
 * embedder's page loses it. So the fork's element says so in an event that is
 * not a focus event. It bubbles, so a chrome can listen on the window it drew
 * rather than on the view.
 *
 * A shell reads it as "the user is working in this window now". See
 * `HTMLWebViewElement::GuestTookFocus` in the engine.
 */
export const WEBVIEW_GUEST_FOCUS_EVENT = "domicile-guest-focus";

/**
 * Fired when the embedded view's history changes what it can do — a page
 * committed, a back taken, a forward spent.
 *
 * THE ENGINE DISPATCHES THIS, and it carries nothing. What changed is readable
 * on the element as {@link HTMLWebViewElement.canGoBack} and
 * {@link HTMLWebViewElement.canGoForward}, and those are the values a chrome
 * renders from; this only says "read them again". A payload here would be a
 * second copy of the same state, correct at the instant it was made and stale
 * for a chrome that read it later.
 *
 * WHICH IS ALSO WHY THE STATE IS NOT THIS EVENT. A shell that mounts after the
 * guest's first commit hears nothing — a React shell registers its listeners
 * in its first effect flush — and an address bar that learned only from events
 * would gray out the wrong button until the user navigated again. The
 * properties are always readable; this is the re-render trigger, not the
 * source of truth.
 *
 * It bubbles, so a chrome can listen on the window it drew rather than on the
 * view.
 */
export const WEBVIEW_HISTORY_CHANGE_EVENT = "domicile-history-change";

/**
 * Fired when the page inside the view starts or stops loading.
 *
 * THE ENGINE DISPATCHES THIS, and like the history event it carries nothing:
 * what changed is readable on the element as
 * {@link HTMLWebViewElement.loading}. The reason is the same one — a payload
 * is a copy of the state that is correct only at the instant it was made — and
 * so is the reason the state is a property rather than this event: a chrome
 * that mounts after the guest has already started loading hears nothing, and
 * an address bar that learned only from events would show a settled page while
 * one was still arriving.
 *
 * NOT ONE EVENT PER NAVIGATION. The browser reports this when the answer
 * changes, so a page that loads a hundred subresources says "loading" once and
 * "not loading" once, and a same-document navigation — a fragment, a
 * `pushState` — says nothing at all, because it is not a load a browser's UI
 * spins for.
 *
 * It bubbles, so a chrome can listen on the window it drew rather than on the
 * view.
 */
export const WEBVIEW_LOADING_CHANGE_EVENT = "domicile-loading-change";

/**
 * Fired when the page inside the view changes: a new address, a new verdict on
 * the connection behind it, or both.
 *
 * THE EVENT THAT MAKES A `<webview>` A BROWSER. Before it, a chrome knew only
 * where it had *sent* a window — `src` is the author's attribute — so a link
 * followed, a redirect taken or a form posted left the address bar showing a
 * page the user had left. What the engine now reports is the guest's *visible
 * entry*: the one a browser's own address bar shows.
 *
 * THE ENGINE DISPATCHES THIS, and like the history and loading events it
 * carries nothing: what changed is readable on the element as
 * {@link HTMLWebViewElement.url} and {@link HTMLWebViewElement.security}. The
 * reason is the same one — a payload is a copy of the state correct only at
 * the instant it was made — and so is the reason the state is a property: a
 * chrome that mounts mid-load is the ordinary case, and one that learned the
 * security level only from an event would have none to draw.
 *
 * READ THE TWO TOGETHER. They arrive in one message, from one read of one
 * entry, so that the address and the lock always describe the same page — see
 * `components/domicile/mojom/web_view_guest.mojom`. A chrome that paired this
 * security with an address from anywhere else (from `src`, say) would draw a
 * padlock beside an address it does not belong to, which is the shape of every
 * address-bar spoof.
 *
 * It bubbles, so a chrome can listen on the window it drew rather than on the
 * view.
 */
export const WEBVIEW_PAGE_CHANGE_EVENT = "domicile-page-change";

/**
 * What the browser says about the connection behind the page in a `<webview>`.
 *
 * `security_state::GetSecurityLevel` narrowed to the four a chrome can draw —
 * the same function, over the same entry, that Chrome's own omnibox lock comes
 * from. Not a scheme: a `https://` that failed to validate is `dangerous`, and
 * a `https://` running active mixed content is too.
 *
 * `""` IS NOT A LEVEL AND MUST NOT BE READ AS ONE. It is what the element
 * reports before the browser has said anything — a guest still on its initial
 * entry — and what an engine older than this contract reports by having no
 * such property at all. A chrome that treated it as "neutral" would be making
 * a claim nobody checked; see `connection-safety.ts` in shell-manganese for
 * what to do with it instead.
 */
export const WEBVIEW_SECURITY_LEVELS = [
  "neutral",
  "secure",
  "warning",
  "dangerous",
] as const;

export type WebViewSecurity = (typeof WEBVIEW_SECURITY_LEVELS)[number];

/**
 * Fired when the page inside the view asks for a window of its own — a link
 * with `target="_blank"`, a `window.open`, a form submitted at a named target
 * that does not exist.
 *
 * THE ENGINE DISPATCHES THIS, and unlike the three above it carries a payload:
 * {@link DomicileNewWindowEvent.url}, the address the page asked for. It has to
 * — there is no element to read the answer off yet, which is the whole of what
 * the page is asking for.
 *
 * WHAT A SHELL DOES WITH IT is open a second browser window at that address.
 * The browser process does NOT make one: a guest with no `SiteInstance` of its
 * own cannot be handed a content-created window without tripping a `CHECK` in
 * `WebContentsImpl::CreateNewWindow`, so the request is refused there and
 * reported here instead. A shell that ignores this event is a desktop where
 * `target="_blank"` does nothing at all, which is what this event exists to
 * stop being the case.
 *
 * WHAT IT COSTS, and it is worth knowing before writing a shell against it: the
 * window the shell opens is a NAVIGATION to that address rather than the window
 * the page asked for. So `window.open()` hands the opener `null`, the opener
 * relationship and `window.name` are not carried, and a form POSTed at a new
 * target arrives as a GET of its action. A link is the case that survives whole,
 * and a link is what this was written for.
 *
 * It bubbles, so a chrome can listen on the window it drew rather than on the
 * view.
 */
export const WEBVIEW_NEW_WINDOW_EVENT = "domicile-new-window";

/**
 * What a `<webview>` is, to everything holding one.
 *
 * Global rather than exported, and merged rather than defined, because the name
 * is already taken twice over: `@types/react` declares an empty
 * `HTMLWebViewElement` and a `webview` entry in `JSX.IntrinsicElements` — left
 * over from Electron — so a shell writing the tag in JSX gets React's element
 * type for its `ref` whatever this module exports. An exported interface of the
 * same shape is a *different* type to that one, and a shell holding the ref
 * cannot assign it anywhere. So this fills in the empty one instead, and the
 * tag-name map beside it is what `document.querySelector("webview")` reads.
 *
 * Written out rather than imported because there is nothing to import from: the
 * interface is the fork's, and the engine ships no `.d.ts`. A shell that runs
 * on stock Chromium gets an `HTMLUnknownElement` with none of it — the same
 * trade `<app>` makes.
 */
declare global {
  // An `interface` rather than a type alias because it is filling in a name
  // the DOM's own lib either declares or will be asked for: a type alias cannot
  // merge, and `extends HTMLElement` is how the shape says what it already is.
  interface HTMLWebViewElement extends HTMLElement {
    /** The address to show. Reflected, so the attribute and the property are
     * one value, the way `<img src>` is. */
    src: string;
    /** Whether {@link HTMLWebViewElement.goBack} would move the page, so an
     * address bar can gray out a button that would do nothing. */
    readonly canGoBack: boolean;
    /** Whether {@link HTMLWebViewElement.goForward} would move the page. */
    readonly canGoForward: boolean;
    /**
     * Whether the page inside the view is loading, so an address bar can show
     * that it is. Changes are announced in
     * {@link WEBVIEW_LOADING_CHANGE_EVENT}.
     */
    readonly loading: boolean;
    /**
     * Where the page actually is — the guest's visible entry, which is the
     * address a browser's own bar shows. NOT {@link HTMLWebViewElement.src},
     * which is where the element was last *sent*.
     *
     * `""` until the browser has said otherwise. Changes are announced in
     * {@link WEBVIEW_PAGE_CHANGE_EVENT}.
     */
    readonly url: string;
    /**
     * What the browser says about the connection behind that page: one of
     * {@link WEBVIEW_SECURITY_LEVELS}, or `""` before the browser has said
     * anything — which is not a level. See {@link WebViewSecurity}.
     *
     * Typed as `string` rather than as the union on purpose: this is the value
     * an engine hands the page, so it is external data, and the union is what
     * a chrome gets after parsing it at that boundary.
     */
    readonly security: string;
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
   * The event {@link WEBVIEW_NEW_WINDOW_EVENT} names, and the one `<webview>`
   * event with anything on it.
   *
   * A type of its own rather than a `CustomEvent` carrying a detail bag,
   * because that is what the engine dispatches — see
   * `third_party/blink/renderer/core/html/domicile/domicile_new_window_event.idl`
   * in the fork. A shell reads `event.url`; nothing here parses a payload out of
   * anything.
   */
  interface DomicileNewWindowEvent extends Event {
    /**
     * The address the page asked to open, resolved against the page that asked
     * — so it is absolute, and it is the address a second view is pointed at.
     */
    readonly url: string;
  }

  /**
   * So that a listener for the name above is handed the event's own type rather
   * than a bare `Event` a shell would have to cast.
   *
   * `HTMLElementEventMap` rather than an interface of this element's own:
   * `addEventListener`'s overloads are resolved through that map for every
   * element, and `HTMLWebViewElement` is declared above as an `HTMLElement`
   * with four methods rather than as an element with an event map of its own.
   * The name is this fork's and cannot collide with anything the platform adds.
   */
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementEventMap {
    "domicile-new-window": DomicileNewWindowEvent;
  }
}
