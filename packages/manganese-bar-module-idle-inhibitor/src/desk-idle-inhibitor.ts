import { perHost } from "@domicile-desktop/manganese-host/per-host";
import { system } from "@domicile-desktop/sdk/system";

import { idleInhibitor } from "./idle-inhibitor";
import { inhibitIdle } from "./portal-inhibit";

/** The idle inhibitor, held once for every bar. */
export const deskIdleInhibitor = perHost((domicile) => {
  const host = system(domicile);
  return idleInhibitor(() => inhibitIdle(host));
});
