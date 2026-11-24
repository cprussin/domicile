import { SPRINGS, springEasing } from "../springs";

/** `property` moving on a `springs.*` token pair, as a computed `transition` reads. */
export const springTransition = (
  property: string,
  spring: keyof typeof SPRINGS,
): string => {
  const { duration, easing } = springEasing(SPRINGS[spring]);
  return `${property} ${duration} ${easing}`;
};
