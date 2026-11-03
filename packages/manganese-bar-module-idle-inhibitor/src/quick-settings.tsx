import { useDomicile } from "@domicile-desktop/react/domicile-provider";

import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { KeepAwakeTile } from "./KeepAwake";
import { useNamedHolders } from "./named-holders";
import { useWakeLockedPages } from "./wake-locked-pages";

/** The desk's keep awake tile, for the quick settings panel. */
export const KeepAwake = () => {
  const domicile = useDomicile();
  const { holders } = useNamedHolders(domicile);
  return (
    <KeepAwakeTile
      holders={holders}
      inhibitor={deskIdleInhibitor(domicile)}
      pages={useWakeLockedPages()}
    />
  );
};
