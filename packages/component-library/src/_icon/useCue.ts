import { useState } from "react";

/**
 * How many times `cue` has changed to a value other than `undefined` since
 * mount. An icon keys a part on it, so each change replays that part's
 * animation and mounting plays nothing.
 */
export const useCue = (cue: unknown): number => {
  const [seen, setSeen] = useState(cue);
  const [count, setCount] = useState(0);
  if (!Object.is(cue, seen)) {
    setSeen(cue);
    if (cue !== undefined) {
      setCount(count + 1);
    }
  }
  return count;
};
