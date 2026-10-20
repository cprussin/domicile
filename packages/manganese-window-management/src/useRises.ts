import { useState } from "react";

/**
 * How many times `value` has gone up since mount, such as how many times a
 * page's finished downloads grew. Key a notice on it to show one per rise.
 */
export const useRises = (value: number): number => {
  const [last, setLast] = useState(value);
  const [rises, setRises] = useState(0);

  // Adjusts state during render rather than in an effect, so the rise shows in
  // the same render as the value.
  if (value !== last) {
    setLast(value);
    if (value > last) {
      setRises(rises + 1);
    }
  }

  return rises;
};
