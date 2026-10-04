// Questions about `DomicileHost.windows` that input routing asks.

import type { DomicileWindow } from "./domicile-host";

/** A client's surface size, in its own pixels. */
export type SurfaceSize = readonly [width: number, height: number];

/**
 * The window `appId` belongs to: itself, or a popup's toplevel window. A click
 * on a menu is a click on its window.
 */
export const windowOf = (
  windows: readonly DomicileWindow[],
  appId: string,
): string => {
  const parent = windows.find((window) => window.appId === appId)?.parent;
  return parent === null || parent === undefined
    ? appId
    : windowOf(windows, parent);
};

/** The size `appId` drew, or `undefined` before it draws. */
export const surfaceSizeOf = (
  windows: readonly DomicileWindow[],
  appId: string,
): SurfaceSize | undefined => {
  const window = windows.find((candidate) => candidate.appId === appId);
  return window?.width === null ||
    window?.width === undefined ||
    window.height === null
    ? undefined
    : [window.width, window.height];
};
