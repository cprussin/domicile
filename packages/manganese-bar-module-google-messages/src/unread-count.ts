/**
 * Messages' unread conversations, for every bar's item. The bar that draws the
 * page sets it; the rest read it.
 */
export type UnreadCount = {
  /** The latest count, `0` before the page gives one. */
  current: () => number;
  set: (count: number) => void;
  /** Calls `onChange` when the count changes, until the returned function. */
  subscribe: (onChange: () => void) => () => void;
};

/** A count of `0` that the page's reads update. */
export const unreadCount = (): UnreadCount => {
  const state = { count: 0 };
  const listeners = new Set<() => void>();
  return {
    current: () => state.count,
    set: (count) => {
      if (count !== state.count) {
        state.count = count;
        for (const onChange of listeners) {
          onChange();
        }
      }
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
};
