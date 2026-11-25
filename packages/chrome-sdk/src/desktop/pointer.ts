// The pointer, which the browser owns.

import type { DomicileHost } from "../domicile-host";
import type { Box } from "./windows";

export type Pointer = {
  /**
   * Put the pointer at a place in the page, in `clientX`/`clientY`
   * coordinates, as focus that follows the pointer needs. Clamped to the
   * page's box; NaN throws.
   *
   * The pointer moves only while it is over one of `onlyOver`, boxes in the
   * same coordinates, and not over `unlessOver`. The engine decides, since the
   * page cannot see the pointer move over a browser window's page.
   */
  warp: (
    x: number,
    y: number,
    onlyOver: readonly Box[],
    unlessOver?: Box,
  ) => void;
  /**
   * Hold the pointer inside `boxes`, in the page's CSS pixels, for a window
   * whose `pointerConstraint` is "confine"; none lets go, as the page going
   * away does. Resolves false where the engine cannot hold it: nested in
   * another compositor, or headless.
   */
  confine: (boxes: readonly Box[]) => Promise<boolean>;
};

const rect = ({ x, y, width, height }: Box): DOMRectReadOnly =>
  new DOMRectReadOnly(x, y, width, height);

export const pointer = (
  host: Pick<DomicileHost, "confinePointer" | "warpPointer">,
): Pointer => ({
  confine: (boxes) => host.confinePointer(boxes.map(rect)),
  warp: (x, y, onlyOver, unlessOver) => {
    host.warpPointer(
      x,
      y,
      onlyOver.map(rect),
      unlessOver === undefined ? undefined : rect(unlessOver),
    );
  },
});
