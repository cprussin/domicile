import { isValidElement } from "react";

import { BarSharing } from "./bar-items";
import type { BarLayout } from "./layout";

/**
 * Whether `layout` has the sharing item, which shows screen casts so the
 * portal dialogs' indicator need not.
 */
export const showsSharing = (layout: BarLayout): boolean =>
  [...layout.left, ...layout.center, ...layout.right].some(
    (item) => isValidElement(item) && item.type === BarSharing,
  );
