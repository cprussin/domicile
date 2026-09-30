import { useEffect, useRef, useState } from "react";

/**
 * `value`, once its `key` has stood for `delayMs`: the last settled one until
 * then.
 *
 * What the preview follows rather than the highlight itself, because a
 * preview per keystroke is a page loaded and thrown away per keystroke.
 *
 * Waited on by key rather than by value, because a choice is a new object on
 * every render and would never be seen to stand. Once a key has settled, it
 * is the value that key has now.
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

  // The key it settled on, as the latest render has it.
  return settled.key === key ? value : settled.value;
};
