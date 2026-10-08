import { WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import type { SitePermission } from "./site-permissions";
import { sitePermissionsOf } from "./site-permissions";

/**
 * The page's site permissions in `view`, empty for a page with no site.
 *
 * Empty, too, from an engine without site permissions, as
 * `connection-safety.ts` allows for an engine without `security`.
 *
 * The change event carries no data, so this reads the element on mount and on
 * each event, as `useShownPage` does.
 *
 * Takes `null` because the element comes from a callback ref.
 */
export const useSitePermissions = (
  view: HTMLWebViewElement | null,
): readonly SitePermission[] => {
  const [permissions, setPermissions] = useState<readonly SitePermission[]>([]);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        // An engine before patch 0103 has no site permissions to report.
        setPermissions(
          "sitePermissions" in view
            ? sitePermissionsOf(view.sitePermissions())
            : [],
        );
      };
      read();
      view.addEventListener(WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_SITE_PERMISSIONS_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return permissions;
};
