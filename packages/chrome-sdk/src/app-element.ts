// The engine's `<app>` element: a Wayland client's window, laid out by the
// page.
//
// The engine defines the element, embeds the surface, reports its size and
// sends the pointer, wheel and keys over it to its client in the client's own
// coordinates. This module only names the tag, the events the engine
// dispatches on it, and its type.

/**
 * The `<app>` tag name, shared by a shell's styles and tests.
 *
 * Nothing registers it: `customElements.define` needs a hyphen in the name, so
 * the engine defines the element.
 */
export const APP_TAG_NAME = "app";

/**
 * Fired on an `<app>` when a click asks for keyboard focus for it. Cancelable,
 * because the shell decides who holds the keyboard.
 *
 * Cancelable so the shell owns focus policy. Left uncanceled, the SDK focuses
 * the client. A shell with its own policy calls `preventDefault()` and later
 * calls `focusApp` itself.
 *
 * The engine dispatches this as a `CustomEvent`, because the click is a pointer
 * event in this document. A page's own `preventDefault()` on the `pointerdown`
 * takes the press, and then nothing is asked. It bubbles so a shell needs only
 * one listener.
 */
export const APP_FOCUS_REQUESTED_EVENT = "domicile-focus-requested";

/** The detail of an {@link APP_FOCUS_REQUESTED_EVENT}. */
export type AppFocusRequest = {
  /** The host's id for the client that was clicked. */
  appId: string;
};

/**
 * Fired on the focused `<app>` when a press lands outside every window.
 *
 * Left uncanceled, keyboard focus returns to the page. A shell that draws
 * chrome for a window, such as a title bar, calls `preventDefault()` when the
 * press hit that chrome; the engine cannot tell which window a `<div>` belongs
 * to. Read {@link AppFocusReleaseRequest.pressed} to decide. It bubbles.
 */
export const APP_FOCUS_RELEASE_REQUESTED_EVENT =
  "domicile-focus-release-requested";

/** The detail of an {@link APP_FOCUS_RELEASE_REQUESTED_EVENT}. */
export type AppFocusReleaseRequest = {
  /** The host's id for the client about to lose keyboard focus. */
  appId: string;
  /** The element the press hit, or `undefined` if there was none. */
  pressed: Element | undefined;
};

/**
 * The engine's `<app>` element type.
 *
 * Declared globally because React types a `ref` from `HTMLElementTagNameMap`;
 * an exported copy would be a distinct type the ref cannot be assigned to. The
 * engine ships no `.d.ts`. On stock Chromium the element is an
 * `HTMLUnknownElement`.
 */
declare global {
  // An `interface` so it can merge with a future DOM lib declaration.
  interface HTMLAppElement extends HTMLElement {
    /**
     * Which window this element shows. Reflects the `app-id` attribute; empty
     * when the attribute is unset.
     */
    appId: string;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface HTMLElementTagNameMap {
    app: HTMLAppElement;
  }
}
