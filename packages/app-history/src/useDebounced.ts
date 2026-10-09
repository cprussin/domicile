import { useEffect, useState } from "react";

/** `value`, once it has gone `delayMs` without changing. */
export const useDebounced = <T>(value: T, delayMs: number): T => {
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
