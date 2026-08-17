// A browser window on the stage: an address bar over a `<domicile-webview>`.
//
// The window is ordinary chrome markup, so the same CSS that styles a Wayland
// client's window styles this one. The webview element owns the navigation
// itself; this module is the controls the user drives it with.

import { WEBVIEW_TAG_NAME } from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";

/** What an address typed without one gets. */
const DEFAULT_SCHEME = "https://";

export type BrowserWindowOptions = {
  src: string;
  /** Called with the address on show whenever the page navigates. */
  onNavigate: (url: string) => void;
};

/** Build a browser window pointed at `src`. */
export const createBrowserWindow = ({
  src,
  onNavigate,
}: BrowserWindowOptions): HTMLElement => {
  const view = createWebview(src);
  const address = createAddressField(src);
  const window = document.createElement("section");
  window.className = "window browser";
  window.append(createAddressBar(view, address), view);

  view.addEventListener(WEBVIEW_NAVIGATE_EVENT, (event) => {
    const { url } = (event as CustomEvent<{ url: string }>).detail;
    address.value = url;
    onNavigate(url);
  });

  return window;
};

const createWebview = (src: string): DomicileWebviewElement => {
  const view = document.createElement(
    WEBVIEW_TAG_NAME,
  ) as DomicileWebviewElement;
  view.className = "surface";
  view.setAttribute("src", src);
  return view;
};

const createAddressField = (src: string): HTMLInputElement => {
  const address = document.createElement("input");
  address.type = "text";
  address.className = "address";
  address.spellcheck = false;
  address.setAttribute("aria-label", "Address");
  address.value = src;
  return address;
};

// A form, so Enter in the address field submits the way a browser's does.
const createAddressBar = (
  view: DomicileWebviewElement,
  address: HTMLInputElement,
): HTMLFormElement => {
  const bar = document.createElement("form");
  bar.className = "address-bar";
  bar.append(
    createControl("Back", "‹", () => {
      view.goBack();
    }),
    createControl("Forward", "›", () => {
      view.goForward();
    }),
    createControl("Stop", "×", () => {
      view.stop();
    }),
    createControl("Reload", "↻", () => {
      view.reload();
    }),
    address,
  );
  bar.addEventListener("submit", (event) => {
    event.preventDefault();
    view.src = withScheme(address.value);
  });
  return bar;
};

const createControl = (
  label: string,
  glyph: string,
  onPress: () => void,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control";
  button.setAttribute("aria-label", label);
  button.textContent = glyph;
  button.addEventListener("click", onPress);
  return button;
};

// `example.com` is an address, not a relative path — a browser's address bar
// says so by loading it over https.
const withScheme = (address: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(address)
    ? address
    : `${DEFAULT_SCHEME}${address}`;
