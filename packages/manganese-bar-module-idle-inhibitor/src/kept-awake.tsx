import { useDomicile } from "@domicile-desktop/react/domicile-provider";

import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { KeptAwake as Pill } from "./KeptAwake";
import { useNamedHolders } from "./named-holders";
import { useWakeLockedPages } from "./wake-locked-pages";

/**
 * Shown while anything keeps the screens on: which apps and websites do, and
 * your own hold with a button to turn it off.
 */
export const KeptAwake = () => {
  const domicile = useDomicile();
  const { holders, icons } = useNamedHolders(domicile);
  return (
    <Pill
      holders={holders}
      icons={icons}
      inhibitor={deskIdleInhibitor(domicile)}
      pages={useWakeLockedPages()}
    />
  );
};
