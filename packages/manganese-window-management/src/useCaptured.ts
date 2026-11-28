import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { browserWindowId } from "./window";

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

/**
 * The window ids of the browser windows the engine is capturing alone, as
 * {@link useCaptured} says of one.
 */
export const useCapturedWindows = (
  domicile: Pick<Domicile, "browser">,
): ReadonlySet<string> => {
  const subscribe = useCallback(
    (changed: () => void) => domicile.browser.on("change", changed),
    [domicile],
  );
  // A string, so the snapshot is the same while the list is.
  const listed = useSyncExternalStore(subscribe, () =>
    (domicile.browser.windows ?? [])
      .filter(({ isCaptured }) => isCaptured)
      .map(({ id }) => browserWindowId(id))
      .join("\n"),
  );
  return useMemo(
    () => new Set(listed === "" ? [] : listed.split("\n")),
    [listed],
  );
};
