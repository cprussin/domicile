import type { Result } from "@cprussin/option-result";
import { useNamedIcons } from "@domicile-desktop/manganese-host/useNamedIcons";
import type { MenuEntry } from "@domicile-desktop/sdk/dbusmenu";
import { MenuEntryKind } from "@domicile-desktop/sdk/dbusmenu";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { ThemedIcon } from "@domicile-desktop/system-apps/app-icons";

import type { MenuIcons } from "./menu-icons";

/**
 * The pictures for the `icon-name`s in `menu`, by name, read with `icons`.
 * Names not read yet, or with no usable icon, are left out. A failed read is
 * logged.
 */
export const useMenuIcons = (
  domicile: Domicile,
  menu: Result<readonly MenuEntry[], SystemError> | undefined,
  icons: MenuIcons,
): ReadonlyMap<string, ThemedIcon> =>
  useNamedIcons(
    domicile,
    menu === undefined
      ? []
      : menu.match({ Err: () => [], Ok: (entries) => namesIn(entries) }),
    icons,
    "Could not read a tray menu's icons",
  );

/** Every icon name in `entries` and their submenus. */
const namesIn = (entries: readonly MenuEntry[]): string[] =>
  entries.flatMap((entry) => {
    switch (entry.kind) {
      case MenuEntryKind.Separator: {
        return [];
      }
      case MenuEntryKind.Item: {
        return [
          ...(entry.icon === undefined ? [] : [entry.icon]),
          ...namesIn(entry.submenu ?? []),
        ];
      }
    }
  });
