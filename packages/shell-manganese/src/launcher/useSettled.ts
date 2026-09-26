import { useEffect, useState } from "react";

/**
 * `value`, once it has stood for `delayMs`: the last settled one until then.
 *
 * What the preview follows rather than the highlight itself, because a
 * preview per keystroke is a page loaded and thrown away per keystroke.
 */
export const useSettled = <T>(value: T, delayMs: number): T => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
};
