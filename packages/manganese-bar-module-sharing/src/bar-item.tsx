import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import { Sharing as Casts } from "./Sharing";

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const Sharing = () => {
  const domicile = useDomicile();
  return <Casts domicile={desktop(domicile)} host={domicile} />;
};
