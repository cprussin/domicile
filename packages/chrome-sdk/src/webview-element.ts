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
    goBack(): void;
    goForward(): void;
    stop(): void;
    reload(): void;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementTagNameMap {
    webview: HTMLWebViewElement;
  }
}
