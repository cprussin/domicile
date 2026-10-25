import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { checkPortal } from "@domicile-desktop/system-network/portal";
import { useEffect, useMemo, useRef, useState } from "react";

import { deskNetwork } from "./desk-network";
import type { PortalWatch } from "./portal-sign-in";
import { followPortals } from "./portal-sign-in";

/** The sign-in page to show, for {@link PortalSignIn}. */
export type CaptivePortal = {
  /** The captive portal's sign-in page, or `undefined` for none. */
  url: string | undefined;
  /** The user closed the page: show it again only on another network. */
  dismiss: () => void;
};

/**
 * The sign-in page of the captive portal on the desk's network, until the
 * portal lets the desk through. Call once for the desk, not per bar.
 */
export const useCaptivePortal = (domicile: DomicileHost): CaptivePortal => {
  const [url, setUrl] = useState<string | undefined>();
  const watch = useRef<PortalWatch | undefined>(undefined);

  useEffect(() => {
    const host = desktop(domicile);
    const followed = followPortals({
      check: () => checkPortal(host),
      network: deskNetwork(domicile).network,
      report: logFailedCheck,
      show: setUrl,
    });
    watch.current = followed;
    return () => {
      followed.stop();
      setUrl(undefined);
    };
  }, [domicile]);

  return useMemo(
    () => ({
      dismiss: () => {
        watch.current?.dismiss();
        setUrl(undefined);
      },
      url,
    }),
    [url],
  );
};

const logFailedCheck = (error: SystemError): void => {
  // biome-ignore lint/suspicious/noConsole: a network without the internet fails the check
  console.warn("Could not check for a captive portal:", error.message);
};
