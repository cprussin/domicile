// The pointer, which the browser owns.

import type { DomicileHost } from "../domicile-host";
import type { EventHost, Unsubscribe } from "./subscribe";
import { hostEvent } from "./subscribe";
import type { Box } from "./windows";

/** A place in the shell page's CSS pixels. */
export type PointerAt = { x: number; y: number };

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
  position: () => Promise<PointerAt | undefined>;
  /**
   * Call `onMove` with where the pointer is, as soon as the engine says and
   * then at most once per frame as it moves, until the returned function
   * runs: `undefined` when it is off the desk. Over a browser window's page too. The engine sends
   * nothing while no one follows.
   */
  follow: (onMove: (at: PointerAt | undefined) => void) => Unsubscribe;
};

const rect = ({ x, y, width, height }: Box): DOMRectReadOnly =>
  new DOMRectReadOnly(x, y, width, height);

export const pointer = (
  host: EventHost &
    Pick<
      DomicileHost,
      | "confinePointer"
      | "pointerPosition"
      | "warpPointer"
      | "watchPointer"
      | "watchedPointer"
    >,
): Pointer => ({
  confine: (boxes) => host.confinePointer(boxes.map(rect)),
  follow: (onMove) => {
    const watch = watchOf(host);
    let following = true;
    if (watch.followers === 0) {
      // First, so a host that throws here leaves no follower counted. The
      // engine answers with where the pointer is now.
      host.watchPointer(true);
    } else if (watch.answered) {
      // Already watched and answered: no event may come soon.
      const now = placeOf(host.watchedPointer);
      queueMicrotask(() => {
        if (following) {
          onMove(now);
        }
      });
    }
    watch.followers += 1;
    const unlisten = hostEvent(host, "watchedpointerchanged", () => {
      watch.answered = true;
      onMove(placeOf(host.watchedPointer));
    });
    return () => {
      if (following) {
        following = false;
        unlisten();
        watch.followers -= 1;
        if (watch.followers === 0) {
          watch.answered = false;
          host.watchPointer(false);
        }
      }
    };
  },
  position: async () => {
    return placeOf(await host.pointerPosition());
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

/** One page's watch: how many follow it, and whether the engine answered. */
type Watch = { followers: number; answered: boolean };

// Per host rather than per `pointer()`: the engine keeps one watch per page,
// so a second `pointer()` on the host must not turn the first's off.
const watches = new WeakMap<object, Watch>();

const watchOf = (host: object): Watch => {
  const known = watches.get(host);
  if (known === undefined) {
    const watch: Watch = { answered: false, followers: 0 };
    watches.set(host, watch);
    return watch;
  } else {
    return known;
  }
};

const placeOf = (at: DOMPointReadOnly | null): PointerAt | undefined =>
  at === null ? undefined : { x: at.x, y: at.y };
