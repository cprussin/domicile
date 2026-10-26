import type { ClientWindow } from "@domicile-desktop/sdk/desktop/windows";

import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

/** Every client window, in the order they appeared. */
export const useWindows = (): readonly ClientWindow[] => {
  const { windows } = useDomicile();
  return useWatch(windows, "change", () => windows.list);
};

/** The window holding the keyboard, or `undefined` while the shell holds it. */
export const useFocusedWindow = (): string | undefined => {
  const { windows } = useDomicile();
  return useWatch(windows, "focuschange", () => windows.focused);
};
