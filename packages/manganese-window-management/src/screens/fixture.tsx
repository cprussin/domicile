import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import type { PropsWithChildren } from "react";

/** The single screen in {@link OnOneScreen}. */
export const SCREEN = "only";

/**
 * A `render` wrapper with a one-screen desktop, for testing panels that open on
 * a screen.
 */
export const OnOneScreen = ({ children }: PropsWithChildren) => (
  <DisplayProvider
    source={{
      displays: [
        { name: SCREEN, position: [0, 0], scale: 1, size: [1920, 1080] },
      ],
      onDisplays: () => () => undefined,
    }}
  >
    {children}
  </DisplayProvider>
);
