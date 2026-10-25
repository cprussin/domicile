import { perHost } from "@domicile-desktop/manganese-host/per-host";

import { idleInhibitor } from "./idle-inhibitor";
import { inhibitIdle } from "./portal-inhibit";

/** The idle inhibitor, held once for every bar. */
export const deskIdleInhibitor = perHost((domicile) => {
  const { dbus } = domicile;
  return idleInhibitor(() => inhibitIdle(dbus, "Kept awake from the bar"));
});
