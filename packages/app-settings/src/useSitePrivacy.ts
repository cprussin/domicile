import { useCallback, useEffect, useState } from "react";

import type { Report } from "./config-editor";
import type { SettingsHost, SitePrivacy, SitePrivacyChange } from "./host";

/**
 * Every browser profile's sites with their own ad blocking, as the shield in
 * a browser window keeps them, listed again after each change, as
 * `useSiteSettings` does.
 */
export const useSitePrivacy = (host: SettingsHost, report: Report) => {
  const [sites, setSites] = useState<SitePrivacy[] | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    host.sitePrivacy().then(
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

  const set = useCallback(
    (change: SitePrivacyChange) => {
      host
        .setSitePrivacy(change)
        .then(reload, report("Couldn't change the site's protections"));
    },
    [host, reload, report],
  );

  return { failure, set, sites };
};
