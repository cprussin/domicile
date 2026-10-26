import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { Sharing as Casts } from "./Sharing";

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const Sharing = () => {
  const domicile = useDomicile();
  return <Casts domicile={domicile} />;
};
