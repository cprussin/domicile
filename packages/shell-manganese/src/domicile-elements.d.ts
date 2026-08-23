import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The SDK's custom elements, as JSX. React passes unknown props on a
// hyphenated tag straight through as attributes, which is exactly the contract
// `DomicileAppElement`/`DomicileWebviewElement` observe — so the tags need no
// wrapper component, only the types that say what they take.

type CustomElementProps<E extends HTMLElement, A> = DetailedHTMLProps<
  HTMLAttributes<E>,
  E
> &
  A;

declare module "react" {
  // biome-ignore lint/style/noNamespace: React declares its JSX types as a namespace; augmenting IntrinsicElements has to match that shape
  namespace JSX {
    // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into IntrinsicElements requires an interface
    interface IntrinsicElements {
      /** A Wayland client's portal. `app-id` is the host's name for it. */
      "domicile-app": CustomElementProps<
        DomicileAppElement,
        { "app-id": string }
      >;
      /** An embedded browsing context. `src` is the address it loads. */
      "domicile-webview": CustomElementProps<
        DomicileWebviewElement,
        { src: string }
      >;
    }
  }
}
