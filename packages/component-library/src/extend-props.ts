import type { ComponentProps, JSX, JSXElementConstructor } from "react";

export type ExtendProps<
  T extends
    | keyof JSX.IntrinsicElements
    // biome-ignore lint/suspicious/noExplicitAny: ExtendProps mirrors React's ComponentProps constraint, which accepts any constructor
    | JSXElementConstructor<any>,
  U = {},
> = U & Omit<ComponentProps<T>, "className" | "style" | keyof U>;
