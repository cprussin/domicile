import { useNamedIcons } from "@domicile-desktop/manganese-host/useNamedIcons";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";

import type { ClientIcons } from "./client-icons";

/**
 * The icons for `desktopIds`, by desktop id, read with `icons` again when the
 * ids change. Ids not read yet, or with no icon, are left out. A failed read is
 * logged, and its windows keep their stand-in.
 */
export const useClientIcons = (
  domicile: Domicile,
  desktopIds: readonly string[],
  icons: ClientIcons,
): ReadonlyMap<string, string> =>
  useNamedIcons(
    domicile,
    desktopIds,
    icons,
    "Could not read the windows' icons",
  );
