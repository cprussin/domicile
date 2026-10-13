// What a bar tells the items in it.

import { createContext } from "react";

import { useProvided } from "../host/use-provided";

/** One bar: the desktop's on a screen, or the lock screen's. */
export type Bar = {
  /** Whether the desktop is locked, so items offer only what it allows. */
  locked: boolean;
  /** The monitor this bar is on, where its panels open. */
  screen: string;
};

export const BarContext = createContext<Bar | undefined>(undefined);

/** The bar this item is on. Throws outside a bar. */
export const useBar = (): Bar => useProvided(BarContext, "a bar (BarContext)");
