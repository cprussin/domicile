/**
 * Which bars show the item, so exactly one draws the page. A second page would
 * be a second Messages session, which Messages refuses.
 */
export type PageBars = {
  /** Adds `screen`'s bar until the returned function is called. */
  show: (screen: string) => () => void;
  /** The bar that draws the page: the first still showing the item. */
  drawer: () => string | undefined;
  /** Calls `onChange` when `drawer` changes, until the returned function. */
  subscribe: (onChange: () => void) => () => void;
};

export const pageBars = (): PageBars => {
  const state: { shown: readonly string[] } = { shown: [] };
  const listeners = new Set<() => void>();
  const changed = (shown: readonly string[]) => {
    state.shown = shown;
    for (const onChange of listeners) {
      onChange();
    }
  };
  return {
    drawer: () => state.shown[0],
    show: (screen) => {
      changed([...state.shown, screen]);
      return () => {
        changed(state.shown.filter((shown) => shown !== screen));
      };
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
};
