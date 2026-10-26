import type { Display } from "@domicile-desktop/sdk/desktop/displays";

import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

/** The screens, or `undefined` until the compositor describes the desktop. */
export const useDisplays = (): readonly Display[] | undefined => {
  const { displays } = useDomicile();
  return useWatch(displays, "change", () => displays.list);
};
