/** `T` with each `null` read as `undefined`, as the desktop's values are. */
export type Defined<T> = {
  readonly [K in keyof T]: null extends T[K]
    ? Exclude<T[K], null> | undefined
    : T[K];
};

/**
 * A plain copy of `value` with `undefined` for each `null`.
 *
 * `for...in` rather than `Object.entries`: the engine's values are platform
 * objects, whose attributes are getters on their prototype.
 */
export const defined = <T extends object>(value: T): Defined<T> => {
  const copy: Record<string, unknown> = {};
  for (const key in value) {
    copy[key] = value[key] ?? undefined;
  }
  return copy as Defined<T>;
};
