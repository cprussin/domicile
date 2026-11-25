import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** One of {@link useLingering}'s items, and whether it is on its way out. */
export type Lingering<T> = { readonly item: T; readonly leaving: boolean };

/**
 * `present`, plus each item that has left it since but not yet finished
 * animating out, marked `leaving`. Call `left` with an item's key once its
 * animation ends, to drop it. An item that comes back stops leaving.
 *
 * The leaving items come after the present ones, in the order they left.
 */
export const useLingering = <T>(
  present: readonly T[],
  keyOf: (item: T) => string,
): {
  readonly shown: readonly Lingering<T>[];
  readonly left: (key: string) => void;
} => {
  const [gone, setGone] = useState<ReadonlyMap<string, T>>(NONE);
  const last = useRef<ReadonlyMap<string, T>>(NONE);
  const now = new Map(present.map((item) => [keyOf(item), item]));

  // Before paint, so an item that left never misses a frame.
  useLayoutEffect(() => {
    const before = last.current;
    last.current = now;
    setGone((previous) => {
      const leftNow = [...before].filter(([key]) => !now.has(key));
      const back = [...previous.keys()].some((key) => now.has(key));
      return leftNow.length === 0 && !back
        ? previous
        : new Map([
            ...[...previous].filter(([key]) => !now.has(key)),
            ...leftNow,
          ]);
    });
  });

  const left = useCallback((key: string) => {
    setGone((previous) => {
      if (!previous.has(key)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }, []);

  return {
    left,
    shown: [
      ...present.map((item) => ({ item, leaving: false })),
      ...[...gone]
        .filter(([key]) => !now.has(key))
        .map(([, item]) => ({ item, leaving: true })),
    ],
  };
};

const NONE: ReadonlyMap<never, never> = new Map<never, never>();
