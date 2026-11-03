import { useDomicile } from "@domicile-desktop/react/domicile-provider";

import { deskIdleInhibitor } from "./desk-idle-inhibitor";
import { IdleInhibitorToggle } from "./IdleInhibitorToggle";
import { useNamedHolders } from "./named-holders";

/**
 * A toggle that keeps the screens from blanking while it is on, and names
 * what else keeps them on.
 */
export const IdleInhibitor = () => {
  const domicile = useDomicile();
  const { holders } = useNamedHolders(domicile);
  return (
    <IdleInhibitorToggle
      holders={holders}
      inhibitor={deskIdleInhibitor(domicile)}
    />
  );
};
