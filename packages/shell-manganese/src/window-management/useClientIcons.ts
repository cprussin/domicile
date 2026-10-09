import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

import type { ClientIcons } from "./client-icons";

/**
 * The icons for `desktopIds`, by desktop id, read with `icons` again when the
 * ids change. Ids not read yet, or with no icon, are left out. A failed read is
 * logged, and its windows keep their stand-in.
 */
export const useClientIcons = (
  domicile: DomicileHost,
  desktopIds: readonly string[],
  icons: ClientIcons,
): ReadonlyMap<string, string> => {
  const [found, setFound] = useState<ReadonlyMap<string, string>>(new Map());
  // The array is new on every render; its contents are what change.
  const key = [...new Set(desktopIds.filter((id) => id !== ""))]
    .toSorted()
    .join("\n");

  useEffect(() => {
    if (key === "") {
      return undefined;
    } else {
      let current = true;
      pictures(domicile, key.split("\n"), icons)
        .then((read) => {
          if (current) {
            setFound(read);
          }
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: windows keep their stand-in icons; say why
          console.error("Could not read the windows' icons", error);
        });
      return () => {
        current = false;
      };
    }
  }, [domicile, icons, key]);

  return found;
};

/** `desktopIds` that have an icon, each with its icon. */
const pictures = async (
  domicile: DomicileHost,
  desktopIds: readonly string[],
  icons: ClientIcons,
): Promise<ReadonlyMap<string, string>> => {
  const lookup = succeeded(await icons(domicile));
  const read = await Promise.all(
    desktopIds.map(async (id) =>
      succeeded(await lookup(id)).match({
        None: () => [],
        Some: (icon): [string, string][] => [[id, icon]],
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
