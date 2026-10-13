import type { Context } from "react";
import { useContext } from "react";

/**
 * The value of `context`, which a provider above must set.
 *
 * Throws without one, naming `what` is missing: a part of the desktop has
 * nothing to show without what it reads.
 */
export const useProvided = <T>(
  context: Context<T | undefined>,
  what: string,
): T => {
  const value = useContext(context);
  if (value === undefined) {
    throw new Error(`manganese: ${what} was not provided`);
  } else {
    return value;
  }
};
