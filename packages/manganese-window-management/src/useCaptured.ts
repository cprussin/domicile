import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the engine is capturing browser window `engineId`'s page alone, as
 * a screenshot, a picker's preview or a screen cast of it does. `undefined`
 * for a window that is not a browser window.
 */
export const useCaptured = (
  domicile: DomicileHost,
  engineId: string | undefined,
): boolean => {
  const subscribe = useCallback(
    (changed: () => void) => {
      domicile.addEventListener("browserwindowschanged", changed);
      return () => {
        domicile.removeEventListener("browserwindowschanged", changed);
      };
    },
    [domicile],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      engineId !== undefined &&
      (domicile.browserWindows?.some(
        ({ id, isCaptured }) => id === engineId && isCaptured,
      ) ??
        false),
  );
};
