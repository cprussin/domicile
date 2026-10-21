import { useCallback, useEffect, useState } from "react";

import type { Report } from "./config-editor";
import type { SettingsHost, SiteData } from "./host";

/** The engine's site data, listed again after each removal. */
export const useSiteData = (host: SettingsHost, report: Report) => {
  const [sites, setSites] = useState<SiteData[] | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    host.siteData().then(
      (listed) => {
        setSites(listed);
        setFailure(undefined);
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  }, [host]);

  useEffect(() => {
    reload();
  }, [reload]);

  const clear = useCallback(
    (cleared: string) => {
      host
        .clearSiteData(cleared)
        .then(reload, report(`Couldn't remove ${cleared}'s data`));
    },
    [host, reload, report],
  );

  return { clear, failure, sites };
};
