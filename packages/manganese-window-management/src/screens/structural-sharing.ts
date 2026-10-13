// Reuses the parts of a fresh layout that equal the last one, so memoized
// components keyed on them by identity skip the render.

/**
 * `next`, with every array and plain object in it that deep-equals its
 * counterpart in `previous` replaced by that counterpart. Anything else is
 * compared with `Object.is`.
 */
export const sharedWith = <T>(previous: T | undefined, next: T): T =>
  // `share` returns `next` or a value deep-equal to it, so still a `T`.
  share(previous, next) as T;

const share = (previous: unknown, next: unknown): unknown => {
  if (Object.is(previous, next)) {
    return previous;
  } else if (Array.isArray(previous) && Array.isArray(next)) {
    const items: unknown[] = next.map((item: unknown, at) =>
      share(previous[at], item),
    );
    return items.length === previous.length &&
      items.every((item, at) => item === previous[at])
      ? previous
      : items;
  } else if (isPlainObject(previous) && isPlainObject(next)) {
    const entries = Object.entries(next).map(
      ([key, value]) => [key, share(previous[key], value)] as const,
    );
    return entries.length === Object.keys(previous).length &&
      entries.every(
        ([key, value]) => key in previous && value === previous[key],
      )
      ? previous
      : Object.fromEntries(entries);
  } else {
    return next;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;
