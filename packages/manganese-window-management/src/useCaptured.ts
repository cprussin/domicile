import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the engine is capturing browser window `engineId`'s page alone, as
 * a screenshot, a picker's preview or a screen cast of it does. `undefined`
 * for a window that is not a browser window.
 */
export const useCaptured = (
  domicile: Pick<Domicile, "browser">,
  engineId: string | undefined,
): boolean => {
  const subscribe = useCallback(
    (changed: () => void) => domicile.browser.on("change", changed),
    [domicile],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      engineId !== undefined &&
      (domicile.browser.windows?.some(
        ({ id, isCaptured }) => id === engineId && isCaptured,
      ) ??
        false),
  );
};
