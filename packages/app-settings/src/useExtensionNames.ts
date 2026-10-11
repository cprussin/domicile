import { useEffect, useState } from "react";

import type { Report } from "./config-editor";
import type { Extensions } from "./extensions";
import type { ExtensionNames } from "./site-groups";

/**
 * Installed extensions' names by id, listed again on every change. Empty
 * until listed, or when listing fails, so sites show their origins.
 */
export const useExtensionNames = (
  extensions: Extensions,
  report: Report,
): ExtensionNames => {
  const [names, setNames] = useState<ExtensionNames>(new Map());

  useEffect(() => {
    const reload = () => {
      extensions.list().then((installed) => {
        setNames(new Map(installed.map(({ id, name }) => [id, name])));
      }, report("Couldn't list extensions"));
    };
    reload();
    return extensions.onChange(reload);
  }, [extensions, report]);

  return names;
};
