import type { Ref, RefCallback, RefObject } from "react";
import { useCallback, useRef } from "react";

/**
 * A ref object plus a stable callback ref that fills it and `forwarded`.
 *
 * Pass the component's own forwarded ref as `forwarded`. base-ui positions
 * popups against the element a trigger's ref receives; without it a popup
 * stays invisible in the corner. The callback changes only when `forwarded`
 * does.
 */
export const useStableRef = <E>(
  forwarded?: Ref<E> | undefined,
): [RefObject<E | null>, RefCallback<E>] => {
  const ref = useRef<E | null>(null);
  const setRef = useCallback<RefCallback<E>>(
    (element) => {
      ref.current = element;
      const release = attach(forwarded, element);
      // Return a cleanup instead of handling `null`, so a forwarded callback
      // ref's own cleanup runs. React 19 does one or the other.
      return () => {
        ref.current = null;
        release();
      };
    },
    [forwarded],
  );
  return [ref, setRef];
};

/** Attaches `element` to any kind of ref and returns the detach function. */
const attach = <E>(forwarded: Ref<E> | undefined, element: E): (() => void) => {
  if (typeof forwarded === "function") {
    const cleanup = forwarded(element);
    return typeof cleanup === "function"
      ? cleanup
      : () => {
          forwarded(null);
        };
  } else if (forwarded === null || forwarded === undefined) {
    return () => {
      // No ref to detach.
    };
  } else {
    forwarded.current = element;
    return () => {
      forwarded.current = null;
    };
  }
};
