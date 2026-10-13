import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { system } from "@domicile-desktop/sdk/system";
import { useMemo } from "react";
import { Sharing as Casts } from "./Sharing";

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const Sharing = () => {
  const domicile = useDomicile();
  const files = useMemo(() => system(domicile), [domicile]);
  return <Casts host={domicile} system={files} />;
};
