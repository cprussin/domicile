import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";

import { deskIdleHolds } from "./desk-idle-holds";
import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { IdleInhibitorToggle } from "./IdleInhibitorToggle";

/**
 * A toggle that keeps the screens from blanking while it is on, and names
 * what else keeps them on.
 */
export const IdleInhibitor = () => {
  const domicile = useDomicile();
  return (
    <IdleInhibitorToggle
      holders={useSharedWatch(deskIdleHolds(domicile))}
      inhibitor={deskIdleInhibitor(domicile)}
    />
  );
};
