// The page's `devicePixelRatio`, kept current as the desk's scale changes.

import { useEffect, useState } from "react";

/** The parts of a window this reads. */
type View = {
  readonly devicePixelRatio: number;
  readonly matchMedia: (
    query: string,
  ) => Pick<EventTarget, "addEventListener" | "removeEventListener">;
};

/**
 * `view`'s `devicePixelRatio`. A `(resolution: …)` query on the current ratio
 * fires `change` when it stops matching, so each ratio gets its own query.
 */
export const useDevicePixelRatio = (view: View = globalThis): number => {
  const [ratio, setRatio] = useState(view.devicePixelRatio);
  useEffect(() => {
    const query = view.matchMedia(`(resolution: ${ratio.toString()}dppx)`);
    const onChange = () => {
      setRatio(view.devicePixelRatio);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [ratio, view]);
  return ratio;
};
