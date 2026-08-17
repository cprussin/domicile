import type { RefCallback, RefObject } from "react";
import { useCallback, useRef } from "react";

/**
 * A `useRef` paired with a stable callback ref that writes into it. Use this
 * when a component needs the underlying DOM element imperatively (e.g. to
 * focus it, snapshot a computed style, or drive a setter from the React
 * synthetic-event tracker) without exposing the raw `useRef` object to a
 * child component that may want a callback ref.
 *
 * The callback identity is stable across renders, so passing it to a child's
 * `ref=` prop won't cause the child to re-attach.
 */
export const useStableRef = <E>(): [RefObject<E | null>, RefCallback<E>] => {
  const ref = useRef<E | null>(null);
  const setRef = useCallback<RefCallback<E>>((el) => {
    ref.current = el;
  }, []);
  return [ref, setRef];
};
