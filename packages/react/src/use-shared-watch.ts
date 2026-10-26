import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useSyncExternalStore } from "react";

import { useDomicile } from "./domicile-provider";
import type { SharedWatch } from "./shared-watch";

/** The latest value of `watch`, or `undefined` before the first. */
export const useSharedWatch = <T>(watch: SharedWatch<T>): T | undefined =>
  useSyncExternalStore(watch.subscribe, watch.current);

/**
 * The latest value of the desktop's `desk` watch, or `undefined` before the
 * first. `desk` is a `perDesktop`, so every caller shares one watch.
 */
export const useDeskWatch = <T>(
  desk: (domicile: Domicile) => SharedWatch<T>,
): T | undefined => useSharedWatch(desk(useDomicile()));
