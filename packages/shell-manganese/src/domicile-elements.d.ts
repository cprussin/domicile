import type { DetailedHTMLProps, HTMLAttributes } from "react";

// JSX types for the engine fork's `<app>` element, which React does not know.
//
// Only `app-id` is declared. `<app>` has no hyphen, so React treats it as a
// plain HTML element and will not set unknown properties or bind its custom
// event; `AppWindow` uses `addEventListener` instead.
//
// `HTMLAppElement` is a global from the SDK, so React's `ref` type and
// `document.querySelector("app")` agree. An exported interface would be a
// different type.

declare module "react" {
  // `<webview>` attributes missing from React's Electron-era types: `window`
  // makes a view show a browser window (see `WEBVIEW_WINDOW_ATTRIBUTE`), and
  // `extensionpopup`, by its presence, makes it an extension's action popup.
  interface WebViewHTMLAttributes<T> extends HTMLAttributes<T> {
    extensionpopup?: string | undefined;
    window?: string | undefined;
  }

  // biome-ignore lint/style/noNamespace: React declares its JSX types as a namespace; augmenting IntrinsicElements has to match that shape
  namespace JSX {
    // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into IntrinsicElements requires an interface
    interface IntrinsicElements {
      /** A Wayland client's window. `app-id` is the host's ID for it. */
      app: DetailedHTMLProps<HTMLAttributes<HTMLAppElement>, HTMLAppElement> & {
        "app-id": string;
      };
    }
  }
}
