import { useMemo, useState } from "react";

import { sharedWith } from "./structural-sharing";

/**
 * `value`, sharing every part equal to the last render's. See
 * {@link sharedWith}.
 */
export const useShared = <T>(value: T): T => {
  // A cache, so mutated in place, as `useStageScreens`'s is.
  const [last] = useState<{ value: T | undefined }>(() => ({
    value: undefined,
  }));
  return useMemo(() => {
    last.value = sharedWith(last.value, value);
    return last.value;
  }, [last, value]);
};
