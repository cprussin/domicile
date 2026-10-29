import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";

import { deskIdleHolds } from "./desk-idle-holds";
import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { KeptAwake as Pill } from "./KeptAwake";

/**
 * Shown while anything keeps the screens on: which apps do, and your own hold
 * with a button to turn it off.
 */
export const KeptAwake = () => {
  const domicile = useDomicile();
  return (
    <Pill
      holders={useSharedWatch(deskIdleHolds(domicile))}
      inhibitor={deskIdleInhibitor(domicile)}
    />
  );
};
