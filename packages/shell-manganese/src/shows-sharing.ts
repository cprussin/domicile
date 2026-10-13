import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";

import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";
import { isValidElement } from "react";

/**
 * Whether `layout` has the sharing item, which shows screen casts so the
 * portal dialogs' indicator need not.
 */
export const showsSharing = (layout: BarLayout): boolean =>
  [...layout.left, ...layout.center, ...layout.right].some(
    (item) => isValidElement(item) && item.type === Sharing,
  );
