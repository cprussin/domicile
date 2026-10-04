import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The fork's `<app>`, as JSX. React has no entry for it — it has had one for
// `<webview>` since Electron, which is why that tag needs only the one attribute
// below — so this is what lets the chrome write the tag at all.
//
// One attribute, and nothing else. `className`, `style`, `hidden` and `ref` are
// `HTMLAttributes`' already, and the element's own event is deliberately not
// here: `<app>` has no hyphen in its name, so React treats the tag as an
// ordinary HTML element rather than as a custom element, and writes neither a
// property it does not recognize nor an `on…` listener for an event it has never
// heard of. `AppWindow` binds that one with `addEventListener`, the way
// `BrowserWindow` binds `<webview>`'s. It was five props when the element was
// the SDK's, because a custom element — which needs the hyphen — does get
// properties written to it.
//
// `HTMLAppElement` is global, declared by the SDK, so the `ref` React resolves
// for the tag and the type `document.querySelector("app")` answers with are one
// type. An interface exported from the SDK instead would be a different type to
// whatever React resolved — the trap `<webview>` fell into.

declare module "react" {
  // And the two attributes of `<webview>`'s React's Electron-era entry lacks:
  // `popupwindow`, which makes a view the extension's window it names — see
  // `WEBVIEW_POPUP_WINDOW_EVENT` — and `extensionpopup`, which makes it an
  // extension's action popup rather than a tab. Strings because attributes
  // are; `extensionpopup`'s presence is the whole of it.
  interface WebViewHTMLAttributes<T> extends HTMLAttributes<T> {
    extensionpopup?: string | undefined;
    popupwindow?: string | undefined;
  }

  // biome-ignore lint/style/noNamespace: React declares its JSX types as a namespace; augmenting IntrinsicElements has to match that shape
  namespace JSX {
    // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into IntrinsicElements requires an interface
    interface IntrinsicElements {
      /** A Wayland client's window. `app-id` is the host's name for it. */
      app: DetailedHTMLProps<HTMLAttributes<HTMLAppElement>, HTMLAppElement> & {
        "app-id": string;
      };
    }
  }
}
