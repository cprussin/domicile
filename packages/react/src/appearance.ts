import type { Appearance } from "@domicile-desktop/sdk/desktop/appearance";
import { useMemo } from "react";

import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

/** The accent, contrast and motion the config asks for, as they change. */
export const useAppearance = (): Appearance => {
  const { appearance } = useDomicile();
  const accentColor = useWatch(
    appearance,
    "change",
    () => appearance.accentColor,
  );
  const highContrast = useWatch(
    appearance,
    "change",
    () => appearance.highContrast,
  );
  const reducedMotion = useWatch(
    appearance,
    "change",
    () => appearance.reducedMotion,
  );
  return useMemo(
    () => ({ accentColor, highContrast, reducedMotion }),
    [accentColor, highContrast, reducedMotion],
  );
};
