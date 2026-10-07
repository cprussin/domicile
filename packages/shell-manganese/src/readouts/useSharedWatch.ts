import { useSyncExternalStore } from "react";

import type { SharedWatch } from "./shared-watch";

/** The latest value of `watch`, or `undefined` before the first. */
export const useSharedWatch = <T>(watch: SharedWatch<T>): T | undefined =>
  useSyncExternalStore(watch.subscribe, watch.current);
