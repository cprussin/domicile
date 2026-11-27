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
  /**
   * Where the pointer is, in the shell page's CSS pixels, or `undefined` when
   * it is off the desk. The engine answers, since the page cannot see the pointer
   * over a browser window's page.
   */
  position: () => Promise<{ x: number; y: number } | undefined>;
};

const rect = ({ x, y, width, height }: Box): DOMRectReadOnly =>
  new DOMRectReadOnly(x, y, width, height);

export const pointer = (
  host: Pick<
    DomicileHost,
    "confinePointer" | "pointerPosition" | "warpPointer"
  >,
): Pointer => ({
  confine: (boxes) => host.confinePointer(boxes.map(rect)),
  position: async () => {
    const at = await host.pointerPosition();
    return at === null ? undefined : { x: at.x, y: at.y };
  },
  warp: (x, y, onlyOver, unlessOver) => {
    host.warpPointer(
      x,
      y,
      onlyOver.map(rect),
      unlessOver === undefined ? undefined : rect(unlessOver),
    );
  },
});
