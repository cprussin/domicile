import { useState } from "react";

/**
 * Whether `depth` last changed downward, so the part keeps its old depth until
 * its box has settled. See `settlingStyles`.
 */
export const useLowered = (depth: number): boolean => {
  const [last, setLast] = useState({ depth, lowered: false });
  // Derived state, updated during render so the change commits with it.
  if (depth !== last.depth) {
    setLast({ depth, lowered: depth < last.depth });
  }
  return depth === last.depth ? last.lowered : depth < last.depth;
};
