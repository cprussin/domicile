import { useCallback, useEffect, useState } from "react";

import type { Extensions, InstalledExtension } from "./extensions";
import type { SettingsHost } from "./host";

/**
 * The installed extensions and the ids the config installed, listed again on
 * every change.
 */
export const useInstalled = (extensions: Extensions, host: SettingsHost) => {
  const [listed, setListed] = useState<
    { installed: InstalledExtension[]; fromConfig: string[] } | undefined
  >(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    Promise.all([extensions.list(), host.configExtensions()]).then(
      ([installed, fromConfig]) => {
        setListed({ fromConfig, installed });
        setFailure(undefined);
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  }, [extensions, host]);

  useEffect(() => {
    reload();
    return extensions.onChange(reload);
  }, [extensions, reload]);

  return { failure, listed, reload };
};
