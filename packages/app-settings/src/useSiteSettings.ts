import { useCallback, useEffect, useState } from "react";

import type { Report } from "./config-editor";
import type { SettingsHost, SitePermission, SiteSettings } from "./host";

/** The engine's site settings, listed again after each change. */
export const useSiteSettings = (host: SettingsHost, report: Report) => {
  const [settings, setSettings] = useState<SiteSettings | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);

  const reload = useCallback(() => {
    host.sitePermissions().then(
      (listed) => {
        setSettings(listed);
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
    (site: SitePermission) => {
      host
        .setSitePermission(site)
        .then(reload, report("Couldn't change the site's permission"));
    },
    [host, reload, report],
  );

  const remove = useCallback(
    (sites: SitePermission[]) => {
      Promise.all(sites.map((site) => host.setSitePermission(site))).then(
        reload,
        report("Couldn't remove the site"),
      );
    },
    [host, reload, report],
  );

  return { failure, remove, set, settings };
};
