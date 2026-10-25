// The pointer, which the browser owns.

import type { DomicileHost } from "../domicile-host";

export type Pointer = {
  /**
   * Put the pointer at a place in the page, in `clientX`/`clientY`
   * coordinates, as focus that follows the pointer needs. Clamped to the
   * page's box; NaN throws.
   */
  warp: (x: number, y: number) => void;
};

export const pointer = (host: Pick<DomicileHost, "warpPointer">): Pointer => ({
  warp: (x, y) => {
    host.warpPointer(x, y);
  },
});
