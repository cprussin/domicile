import { perHost } from "@domicile-desktop/manganese-host/per-host";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";

import { idleInhibitor } from "./idle-inhibitor";
import { inhibitIdle } from "./portal-inhibit";

/** The idle inhibitor, held once for every bar. */
export const deskIdleInhibitor = perHost((domicile) => {
  const { dbus } = desktop(domicile);
  return idleInhibitor(() => inhibitIdle(dbus));
});
