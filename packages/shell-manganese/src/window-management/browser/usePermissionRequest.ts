import type { WebViewPermission } from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_PERMISSION_REQUEST_EVENT,
  WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import { permissionsAsked } from "./site-permissions";

/** A permission request the page is waiting on. */
export type PermissionRequest = {
  /** The asking site's origin. */
  origin: string;
  permissions: readonly WebViewPermission[];
  /** Allow or block the site, stored for it. */
  allow: () => void;
  deny: () => void;
  /** Close without choosing; nothing is stored. */
  dismiss: () => void;
};

/**
 * The permission request the page in `view` is waiting on, if any.
 *
 * `preventDefault()` claims it; the engine ignores unclaimed ones when
 * dispatch returns (see `WEBVIEW_PERMISSION_REQUEST_EVENT`). A permission this
 * shell cannot show throws before claiming, so the engine ignores it.
 *
 * The engine sends one at a time. Answering clears it, as does the engine
 * withdrawing it. Unmounting answers nothing: the engine ignores a request
 * whose element is gone.
 *
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const usePermissionRequest = (
  view: HTMLElement | null,
): PermissionRequest | undefined => {
  const [request, setRequest] = useState<PermissionRequest | undefined>(
    undefined,
  );

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const cleared = () => {
        setRequest(undefined);
      };
      const asked = (event: DomicilePermissionRequestEvent) => {
        const permissions = permissionsAsked(event.permissions);
        event.preventDefault();
        const answering = (answer: () => void) => () => {
          cleared();
          answer();
        };
        setRequest({
          allow: answering(() => {
            event.allow();
          }),
          deny: answering(() => {
            event.deny();
          }),
          dismiss: answering(() => {
            event.dismiss();
          }),
          origin: event.origin,
          permissions,
        });
      };
      view.addEventListener(WEBVIEW_PERMISSION_REQUEST_EVENT, asked);
      view.addEventListener(
        WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT,
        cleared,
      );
      return () => {
        view.removeEventListener(WEBVIEW_PERMISSION_REQUEST_EVENT, asked);
        view.removeEventListener(
          WEBVIEW_PERMISSION_REQUEST_WITHDRAWN_EVENT,
          cleared,
        );
      };
    }
  }, [view]);

  return request;
};
