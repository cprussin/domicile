import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";

import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { IdleInhibitorToggle } from "./IdleInhibitorToggle";

/** A toggle that keeps the screens from blanking while it is on. */
export const IdleInhibitor = () => (
  <IdleInhibitorToggle inhibitor={deskIdleInhibitor(useDomicile())} />
);
