import type { Option, Result } from "@cprussin/option-result";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

/** A lookup of icons by name, opened on a desktop. */
export type NamedIcons<Icon extends NonNullable<unknown>> = (
  domicile: Domicile,
) => Promise<
  Result<
    (name: string) => Promise<Result<Option<Icon>, SystemError>>,
    SystemError
  >
>;

/**
 * The icons for `names`, by name, read with `icons` again when the names
 * change. Empty names, names not read yet and names with no icon are left
 * out. A failed read is logged as `failure`, and what was found before stays.
 */
export const useNamedIcons = <Icon extends NonNullable<unknown>>(
  domicile: Domicile,
  names: readonly string[],
  icons: NamedIcons<Icon>,
  failure: string,
): ReadonlyMap<string, Icon> => {
  const [found, setFound] = useState<ReadonlyMap<string, Icon>>(new Map());
  // The array is new on every render; its contents are what change.
  const key = [...new Set(names.filter((name) => name !== ""))]
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
          // biome-ignore lint/suspicious/noConsole: what needs the icons keeps its stand-ins; say why
          console.error(failure, error);
        });
      return () => {
        current = false;
      };
    }
  }, [domicile, failure, icons, key]);

  return found;
};

/** `names` that have an icon, each with its icon. */
const pictures = async <Icon extends NonNullable<unknown>>(
  domicile: Domicile,
  names: readonly string[],
  icons: NamedIcons<Icon>,
): Promise<ReadonlyMap<string, Icon>> => {
  const lookup = succeeded(await icons(domicile));
  const read = await Promise.all(
    names.map(async (name) =>
      succeeded(await lookup(name)).match({
        None: () => [],
        Some: (icon): [string, Icon][] => [[name, icon]],
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
