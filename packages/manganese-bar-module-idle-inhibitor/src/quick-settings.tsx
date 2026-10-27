import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";

import { deskIdleHolds } from "./desk-idle-holds";
import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { KeepAwakeGlyph, KeepAwakeTile } from "./KeepAwake";

/** The desk's keep awake eye, for the quick settings button. */
export const KeepAwakeIndicator = () => {
  const domicile = useDomicile();
  return (
    <KeepAwakeGlyph
      holders={useSharedWatch(deskIdleHolds(domicile))}
      inhibitor={deskIdleInhibitor(domicile)}
    />
  );
};

/** The desk's keep awake tile, for the quick settings panel. */
export const KeepAwake = () => {
  const domicile = useDomicile();
  return (
    <KeepAwakeTile
      holders={useSharedWatch(deskIdleHolds(domicile))}
      inhibitor={deskIdleInhibitor(domicile)}
    />
  );
};
