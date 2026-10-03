import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import type { PropsWithChildren } from "react";

/** The one screen of {@link OnOneScreen}'s desk. */
export const SCREEN = "only";

/**
 * A desk of one screen, for a test of a panel that opens on a screen: a
 * `render` wrapper.
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
