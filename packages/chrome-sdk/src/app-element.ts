// The fork's `<app>`: a Wayland client's window, laid out by the page.
//
// There is no element class here, and that is the point. The element belongs to
// the engine — `app-id` is a reflected content attribute, and the surface embed
// and the size the client is configured at are both the layout box's, reported
// by `LayoutAppSurface` without anything in the page asking. What is left for
// the SDK to say is the part TypeScript cannot read off the fork: what the tag
// is, and what the SDK dispatches on it.
//
// It used to be a `<domicile-app>` custom element, because a custom element's
// name must contain a hyphen and the SDK predates the fork. That element did
// far more than forward: it created a `<canvas>` and called
// `embedExternalSurface` on it, it measured its own box and reported it, it
// mapped pointer coordinates, and it took five methods and three properties a
// shell wrote to. The canvas and the embed are the engine's now; the rest moved
// to document-level delegation over `closest("app")`, which is what
// `registerElements` installs — see `pointer-input.ts` and `keyboard-input.ts`.

/**
 * The tag a shell writes.
 *
 * Exported because the SDK's own delegation and a shell's stylesheets and tests
 * all have to name it, and one literal is better than five. Nothing registers
 * it: `customElements.define` cannot take a name without a hyphen, which is
 * exactly why the fork defines the element instead.
 */
export const APP_TAG_NAME = "app";

/**
 * Fired on an `<app>` when something asks for the keyboard on its behalf — a
 * click, today — and cancellable, because who holds the keyboard is the
 * shell's to decide rather than the SDK's.
 *
 * Left uncancelled it focuses the client, so a shell with no focus policy of
 * its own needs to know nothing about this. A shell that has one — focus that
 * follows the pointer, a window that may not be interrupted, a click that
 * raises without focusing — calls `preventDefault()` and then does whatever it
 * decided, which is usually `focusApp` a moment later.
 *
 * THE SDK DISPATCHES THIS, unlike `<webview>`'s two events, which the engine
 * does. A click inside an `<app>` is a pointer event in this document — the
 * client is a surface rather than a browsing context — so the page is where the
 * question can be asked at all.
 *
 * It bubbles: a shell renders one `<app>` per window and would otherwise have
 * to bind a listener to each.
 */
export const APP_FOCUS_REQUESTED_EVENT = "domicile-focus-requested";

/** The detail of an {@link APP_FOCUS_REQUESTED_EVENT}. */
export type AppFocusRequest = {
  /** The host's name for the client whose window was reached for. */
  appId: string;
};

/**
 * What an `<app>` is, to everything holding one.
 *
 * Global rather than exported, and declared rather than imported, for the same
 * two reasons `<webview>`'s interface is. React resolves a `ref` on a tag to
 * whatever global interface the tag-name map names, so an identically-shaped
 * interface exported from here would be a *different* type that a shell holding
 * the ref could not assign anywhere — the trap `<webview>` fell into, where
 * `@types/react` had already declared the name. Nothing has declared this one,
 * so the SDK is free to; it is declared the same way anyway, because the shape
 * of the answer should not depend on who got there first.
 *
 * And there is nothing to import from: the interface is the fork's, and the
 * engine ships no `.d.ts`. A shell that runs on stock Chromium gets an
 * `HTMLUnknownElement` with none of it — the same trade `<webview>` makes, and
 * the reason the SDK's delegation reads `app-id` off the attribute rather than
 * off this property.
 */
declare global {
  // An `interface` rather than a type alias because it is filling in a name
  // the DOM's own lib either declares or will be asked for: a type alias cannot
  // merge, and `extends HTMLElement` is how the shape says what it already is.
  interface HTMLAppElement extends HTMLElement {
    /**
     * Which window this element shows. Reflected, so the attribute and the
     * property are one value, the way `<img src>` is — and empty rather than
     * absent when the attribute is not set, which is what a reflected
     * `DOMString` does.
     */
    appId: string;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementTagNameMap {
    app: HTMLAppElement;
  }
}
