// Questions about `DomicileHost.windows` that input routing asks.

import type { DomicileWindow } from "./domicile-host";

/**
 * How big a client's surface is, in its own pixels — what it drew — or
 * `undefined` before it has drawn.
 */
export type SurfaceSize = readonly [width: number, height: number];

/**
 * The window `appId` belongs to: itself, or for a popup the window under it,
 * however many popups deep. A click on a menu is a click on its window.
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

/** What `appId` drew, or `undefined` for one that has not drawn. */
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
