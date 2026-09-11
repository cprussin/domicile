import type {
  APP_FOCUS_REQUESTED_EVENT,
  AppFocusRequest,
  DomicileAppElement,
  SurfaceSize,
} from "@domicile/chrome-sdk/app-element";
import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The SDK's custom elements, as JSX. React passes an unknown prop on a
// hyphenated tag straight through as an attribute unless the element declares a
// property of that name, in which case it writes the property instead — which
// is exactly the contract `DomicileAppElement`/`DomicileWebviewElement`
// observe, so the tags need no wrapper component, only the types that say what
// they take.

type CustomElementProps<E extends HTMLElement, A> = DetailedHTMLProps<
  HTMLAttributes<E>,
  E
> &
  A;

/**
 * The element's own event, as the prop React binds a listener from.
 *
 * React reads any `on`-prefixed function prop on a custom element as a
 * listener for the event whose name follows, verbatim and case for case. The
 * key is built from the SDK's own constant rather than spelled out, so a shell
 * that writes the wrong event name does not compile.
 */
type AppFocusRequestedProp = {
  [Prop in `on${typeof APP_FOCUS_REQUESTED_EVENT}`]?: (
    event: CustomEvent<AppFocusRequest>,
  ) => void;
};

declare module "react" {
  // biome-ignore lint/style/noNamespace: React declares its JSX types as a namespace; augmenting IntrinsicElements has to match that shape
  namespace JSX {
    // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into IntrinsicElements requires an interface
    interface IntrinsicElements {
      /**
       * A Wayland client's portal. `app-id` is the host's name for it; the rest
       * are what the element has to be told about the client behind it.
       */
      "domicile-app": CustomElementProps<
        DomicileAppElement,
        AppFocusRequestedProp & {
          "app-id": string;
          cursor?: CursorShape | undefined;
          focused?: boolean;
          surfaceSize?: SurfaceSize | undefined;
        }
      >;
      /** An embedded browsing context. `src` is the address it loads. */
      "domicile-webview": CustomElementProps<
        DomicileWebviewElement,
        { src: string }
      >;
    }
  }
}
