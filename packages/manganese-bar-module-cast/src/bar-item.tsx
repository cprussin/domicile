import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { casting, engineCast } from "@domicile-desktop/sdk/cast";
import { useMemo } from "react";
import { Cast as Item } from "./Cast";

/**
 * Casting to TVs: shown while a TV is near, to extend the desktop onto it or
 * cast a window, a monitor or a region. The engine's Google Cast finds them;
 * `domicile-miracast` joins it when it lands.
 */
export const Cast = () => {
  const domicile = useDomicile();
  const casts = useMemo(() => casting(domicile), [domicile]);
  const backends = useMemo(() => [engineCast(domicile.googleCast)], [domicile]);
  return <Item backends={backends} casting={casts} />;
};
