import type { AnimationEvent } from "react";

/**
 * Whether `event` ends an animation the element is playing now, rather than
 * one bubbling up from a descendant or one the element's motion has since
 * replaced.
 *
 * A motion that replaces another mid-flight, such as a tab switched again
 * before its fade is done, can still get the end of the old motion's
 * animation: the compositor finished it before the page restyled. Taken as
 * the end of the new motion, it would cut that motion short.
 *
 * An element with no animation names, as in a test DOM, takes any end.
 */
export const endsOwnAnimation = (event: AnimationEvent<Element>): boolean => {
  if (event.target !== event.currentTarget) {
    return false;
  }
  const names = getComputedStyle(event.currentTarget)
    .animationName.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "" && name !== "none");
  return names.length === 0 || names.includes(event.animationName);
};
