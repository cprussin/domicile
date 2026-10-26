import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { casting, engineCast } from "@domicile-desktop/sdk/cast";
import { miracastCast } from "@domicile-desktop/sdk/miracast";
import { useMemo } from "react";
import { Cast as Item } from "./Cast";

/**
 * Casting to TVs: shown while a TV is near, to extend the desktop onto it or
 * cast a window, a monitor or a region. The engine's Google Cast and
 * `domicile-miracast` find them.
 */
export const Cast = () => {
  const domicile = useDomicile();
  const casts = useMemo(() => casting(domicile), [domicile]);
  const backends = useMemo(
    () => [engineCast(domicile.googleCast), miracastCast(domicile)],
    [domicile],
  );
  return <Item backends={backends} casting={casts} />;
};
