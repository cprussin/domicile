import { perDesktop } from "@domicile-desktop/react/per-desktop";

import { idleInhibitor } from "./idle-inhibitor";
import { inhibitIdle } from "./portal-inhibit";

/** The idle inhibitor, held once for every bar. */
export const deskIdleInhibitor = perDesktop((domicile) => {
  const { dbus } = domicile;
  return idleInhibitor(() => inhibitIdle(dbus, "Kept awake from the bar"));
});
