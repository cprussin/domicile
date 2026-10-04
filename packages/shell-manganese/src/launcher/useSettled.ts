import { useEffect, useRef, useState } from "react";

/**
 * `value` once `key` has been stable for `delayMs`; until then, the last
 * settled value.
 *
 * The preview uses this so it does not load a page per keystroke. It waits on
 * the key rather than the value because a choice is a new object every render.
 */
export const useSettled = <T>(value: T, key: unknown, delayMs: number): T => {
  const [settled, setSettled] = useState({ key, value });
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled({ key, value: latest.current });
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [key, delayMs]);

  // Once settled, return the current value for that key.
  return settled.key === key ? value : settled.value;
};
