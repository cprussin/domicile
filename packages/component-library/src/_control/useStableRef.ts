import type { Ref, RefCallback, RefObject } from "react";
import { useCallback, useRef } from "react";

/**
 * A `useRef` paired with a callback ref that writes into it. Use this when a
 * component needs the underlying DOM element imperatively (e.g. to focus it,
 * snapshot a computed style, or drive a setter from the React synthetic-event
 * tracker) without exposing the raw `useRef` object to a child component that
 * may want a callback ref.
 *
 * **Pass `forwarded` whatever ref the component was given.** A control that
 * kept only its own ref would hand the element back to nobody, and what breaks
 * is not obvious from the call site: base-ui positions a popover, a select
 * popup or a tooltip against the element its trigger handed back, so a trigger
 * that hands back nothing leaves the panel unpositioned in the corner of the
 * screen, drawn at `opacity: 0` and looking for all the world like it never
 * opened.
 *
 * The callback's identity is stable while `forwarded` is — which is always,
 * for a component given no ref at all — so passing it to a child's `ref=` does
 * not make the child re-attach on every render. A *new* forwarded ref does
 * change it, which is the point: React detaches the old one and attaches the
 * new, so the element reaches whoever is asking for it now.
 */
export const useStableRef = <E>(
  forwarded?: Ref<E> | undefined,
): [RefObject<E | null>, RefCallback<E>] => {
  const ref = useRef<E | null>(null);
  const setRef = useCallback<RefCallback<E>>(
    (element) => {
      ref.current = element;
      const release = attach(forwarded, element);
      // A cleanup rather than waiting for React to call this again with
      // `null`: React 19 does one or the other, and returning a cleanup is
      // what lets a forwarded callback ref's own cleanup be honoured.
      return () => {
        ref.current = null;
        release();
      };
    },
    [forwarded],
  );
  return [ref, setRef];
};

/**
 * Give `element` to whatever kind of ref `forwarded` is, and answer with the
 * undoing of it.
 *
 * `null` as well as `undefined` because React's own `Ref` type has it: a ref
 * prop that is explicitly nothing arrives as `null`.
 */
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
      // Nothing was given the element, so there is nothing to take back.
    };
  } else {
    forwarded.current = element;
    return () => {
      forwarded.current = null;
    };
  }
};
