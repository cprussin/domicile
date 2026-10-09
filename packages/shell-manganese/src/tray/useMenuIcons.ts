import type { Result } from "@cprussin/option-result";
import type { MenuEntry } from "@domicile-desktop/sdk/dbusmenu";
import { MenuEntryKind } from "@domicile-desktop/sdk/dbusmenu";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

import type { menuIcons } from "./menu-icons";

/**
 * The pictures for the `icon-name`s in `menu`, by name, read with `icons`.
 * Names not read yet, or with no usable icon, are left out. A failed read is
 * logged.
 */
export const useMenuIcons = (
  domicile: DomicileHost,
  menu: Result<readonly MenuEntry[], SystemError> | undefined,
  icons: typeof menuIcons,
): ReadonlyMap<string, string> => {
  const [found, setFound] = useState<ReadonlyMap<string, string>>(new Map());
  // The menu is new on every read; its names are what change.
  const key =
    menu === undefined
      ? ""
      : menu.match({
          Err: () => "",
          Ok: (entries) => [...new Set(namesIn(entries))].toSorted().join("\n"),
        });

  useEffect(() => {
    if (key === "") {
      return undefined;
    } else {
      let current = true;
      pictures(system(domicile), key.split("\n"), icons)
        .then((read) => {
          if (current) {
            setFound(read);
          }
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: entries stay without icons; say why
          console.error("Could not read a tray menu's icons", error);
        });
      return () => {
        current = false;
      };
    }
  }, [domicile, icons, key]);

  return found;
};

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

/** `names` that have an icon, each with its `data:` URL. */
const pictures = async (
  host: System,
  names: readonly string[],
  icons: typeof menuIcons,
): Promise<ReadonlyMap<string, string>> => {
  const lookup = succeeded(await icons(host));
  const read = await Promise.all(
    names.map(async (name) =>
      succeeded(await lookup(name)).match({
        None: () => [],
        Some: (url): [string, string][] => [[name, url]],
      }),
    ),
  );
  return new Map(read.flat());
};

/** The value, or a throw: a desktop that refuses to read fails the lookup. */
const succeeded = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.match({
    Err: (error) => {
      throw new Error(`could not read the icons: ${error.message}`);
    },
    Ok: (value) => value,
  });
