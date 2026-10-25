import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import type { CastBackend } from "@domicile-desktop/sdk/cast";
import { casting } from "@domicile-desktop/sdk/cast";
import { useMemo } from "react";
import { Cast as Item } from "./Cast";

/**
 * What finds TVs. None yet: the engine's Google Cast and `domicile-miracast`
 * join it as they land, so the item stays hidden until then.
 */
const BACKENDS: readonly CastBackend[] = [];

/**
 * Casting to TVs: shown while a TV is near, to extend the desktop onto it or
 * cast a window, a monitor or a region.
 */
export const Cast = () => {
  const domicile = useDomicile();
  const casts = useMemo(() => casting(domicile), [domicile]);
  return <Item backends={BACKENDS} casting={casts} />;
};
