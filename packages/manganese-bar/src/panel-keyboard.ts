// Lets a bar item's panel keep the keyboard, as the desktop's own panels do.

import { useProvided } from "@domicile-desktop/manganese-host/use-provided";
import { createContext, useEffect } from "react";

/**
 * Takes the keyboard off the windows until the returned function is called.
 * The page keeps it while any panel holds it; see `AppWindow`.
 */
export type HoldKeyboard = () => () => void;

export const PanelKeyboardContext = createContext<HoldKeyboard | undefined>(
  undefined,
);

/**
 * Keeps the keyboard on the page while `open`, for a panel to type into.
 * Throws outside the desktop.
 */
export const useKeepsKeyboard = (open: boolean): void => {
  const hold = useProvided(PanelKeyboardContext, "the desktop's keyboard");
  useEffect(() => (open ? hold() : undefined), [hold, open]);
};
