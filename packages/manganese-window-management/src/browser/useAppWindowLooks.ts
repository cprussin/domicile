import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { shapeClipPath } from "./app-window-shape";

/** What an Electron app asks of its window's looks and input. */
export type AppWindowLooks = {
  /** It asks for the user's attention (`win.flashFrame`). */
  urgent: boolean;
  /** The pointer goes through it to what is under it (`setIgnoreMouseEvents`). */
  ignoresPointer: boolean;
  /** The `clip-path` its page draws and takes input within (`setShape`). */
  clipPath: string | undefined;
};

/**
 * Browser window `engineId`'s looks and input, as its Electron app asks.
 * Any other window asks for nothing.
 */
export const useAppWindowLooks = (
  domicile: Pick<Domicile, "browser">,
  engineId: string,
): AppWindowLooks => {
  const subscribe = useCallback(
    (changed: () => void) => domicile.browser.on("change", changed),
    [domicile],
  );
  const listed = () =>
    domicile.browser.windows?.find(({ id }) => id === engineId);
  // Each read a string or a boolean, so each is stable between changes as
  // `useSyncExternalStore` needs.
  const urgent = useSyncExternalStore(
    subscribe,
    () => listed()?.urgent ?? false,
  );
  const ignoresPointer = useSyncExternalStore(
    subscribe,
    () => listed()?.ignoresPointer ?? false,
  );
  const shape = useSyncExternalStore(subscribe, () => listed()?.shape);
  return useMemo(
    () => ({
      clipPath: shape === undefined ? undefined : shapeClipPath(shape),
      ignoresPointer,
      urgent,
    }),
    [ignoresPointer, shape, urgent],
  );
};
