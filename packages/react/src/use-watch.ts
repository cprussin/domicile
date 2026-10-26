// The one way a hook here follows the desktop: read an attribute again each
// time its namespace says it changed.

import type { Unsubscribe } from "@domicile-desktop/sdk/desktop/subscribe";
import { useCallback, useSyncExternalStore } from "react";

/** A namespace of the desktop, or anything with its `on`. */
export type Watchable<K extends string> = {
  on: (type: K, listener: () => void) => Unsubscribe;
};

/**
 * What `read` answers, read again on each `type` event of `source`.
 *
 * `read` must answer the same value until the event: the desktop's lists keep
 * their identity between changes, so reading an attribute does.
 */
export const useWatch = <K extends string, T>(
  source: Watchable<K>,
  type: NoInfer<K>,
  read: () => T,
): T => {
  const subscribe = useCallback(
    (onChange: () => void) => source.on(type, onChange),
    [source, type],
  );
  return useSyncExternalStore(subscribe, read);
};
