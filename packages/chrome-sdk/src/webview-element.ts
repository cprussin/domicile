// The `<domicile-webview>` custom element: web content the engine renders
// directly (a nested browsing context), so the element is a typed facade over
// the embed — the address it shows, the history controls a chrome's address bar
// drives, and the navigations the content performs on its own.

import { z } from "zod";

/**
 * Fired on the element when the embedded view lands on a page, however it got
 * there. `detail.url` is the address now showing.
 */
export const WEBVIEW_NAVIGATE_EVENT = "domicile-navigate";

// The navigation surface Electron adds to its `<webview>` tag. The eventual
// engine gives a CEF browsing context the same shape.
type WebviewFrame = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  stop: () => void;
  reload: () => void;
};

// The events Electron's `<webview>` fires once a navigation has committed:
// a load the chrome asked for, a link the user followed, a redirect, or a
// same-document push.
const NAVIGATION_EVENTS = ["did-navigate", "did-navigate-in-page"] as const;

// Those events carry the address as a property on the DOM event. It comes from
// a nested browsing context, so it is parsed rather than cast.
const navigationEventSchema = z.looseObject({ url: z.string() });

export class DomicileWebviewElement extends HTMLElement {
  static observedAttributes = ["src"];

  #view: WebviewFrame | undefined;
  #loaded: string | undefined;

  get src(): string | undefined {
    return this.getAttribute("src") ?? undefined;
  }

  set src(value: string) {
    this.setAttribute("src", value);
  }

  connectedCallback(): void {
    this.#load();
  }

  attributeChangedCallback(name: string): void {
    if (name === "src") {
      this.#load();
    }
  }

  goBack(): void {
    this.#ensureView().goBack();
  }

  goForward(): void {
    this.#ensureView().goForward();
  }

  stop(): void {
    this.#ensureView().stop();
  }

  reload(): void {
    this.#ensureView().reload();
  }

  // Navigate the embed to whatever `src` now says. The address the embed
  // reached on its own is already loaded there, so pushing it back would
  // restart the load it just finished.
  #load(): void {
    const view = this.#ensureView();
    const src = this.src;
    if (src !== undefined && src !== this.#loaded) {
      this.#loaded = src;
      view.setAttribute("src", src);
    }
  }

  // In the Electron host this is a real `<webview>` (a separate browsing
  // context, so it can load sites that forbid `<iframe>` embedding); the
  // eventual engine maps `<domicile-webview>` to a native CEF browsing context.
  #ensureView(): WebviewFrame {
    this.#view ??= this.#embedView();
    return this.#view;
  }

  #embedView(): WebviewFrame {
    const view = this.appendChild(createWebviewFrame());
    for (const type of NAVIGATION_EVENTS) {
      view.addEventListener(type, (event) => {
        this.#followNavigation(event);
      });
    }
    return view;
  }

  // The embed moved: follow it, so `src` is always the address on screen and a
  // chrome's address bar has one place to read it from.
  #followNavigation(event: Event): void {
    const { url } = navigationEventSchema.parse(event);
    this.#loaded = url;
    this.src = url;
    this.dispatchEvent(
      new CustomEvent(WEBVIEW_NAVIGATE_EVENT, { detail: { url } }),
    );
  }
}

const createWebviewFrame = (): WebviewFrame => {
  const view = document.createElement("webview") as WebviewFrame;
  view.className = "domicile-webview-frame";
  return view;
};
