import { useCallback, useEffect, useState } from "react";

import type { Extensions, InstalledExtension } from "./extensions";

/** The installed extensions, listed again on every change. */
export const useInstalled = (extensions: Extensions) => {
  const [installed, setInstalled] = useState<InstalledExtension[] | undefined>(
    undefined,
  );
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    extensions.list().then(
      (listed) => {
        setInstalled(listed);
        setFailure(undefined);
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  }, [extensions]);

  useEffect(() => {
    reload();
    return extensions.onChange(reload);
  }, [extensions, reload]);

  return { failure, installed, reload };
};
