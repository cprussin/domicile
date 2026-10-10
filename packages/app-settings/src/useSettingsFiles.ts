import { useCallback, useEffect, useState } from "react";

import type { SettingsFiles, SettingsHost, Target } from "./host";

/** The desktop's files, read again whenever one changes on disk. */
export const useSettingsFiles = (host: SettingsHost) => {
  const [files, setFiles] = useState<SettingsFiles | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    host.read().then(
      (read) => {
        setFiles(read);
        setFailure(undefined);
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  }, [host]);

  useEffect(() => {
    reload();
    return host.onChange(reload);
  }, [host, reload]);

  /** Replaces a file, then shows what the host wrote. */
  const write = useCallback(
    async (file: Target, text: string) => {
      await host.write(file, text);
      reload();
    },
    [host, reload],
  );

  return { failure, files, write };
};
