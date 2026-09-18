import { useCallback, useEffect, useRef, useState } from "react";

import type { Closing } from "./closing";
import { departed } from "./closing";
import type { Placement } from "./placement";
import type { ShellWindow } from "./window";

/** The windows on their way out, and how one says it has finished leaving. */
export type Closings = {
  closing: readonly Closing[];
  /** Called by a window that has played all the way out. */
  onGone: (id: string) => void;
};

/**
 * The windows that have closed and are still on screen.
 *
 * **What the desktop was, compared against what it is.** Nothing announces a
 * close — the reduction that ends a window ends it everywhere at once — so the
 * only place the fact survives is the difference between two renders, which is
 * what the ref below holds. The placements are kept beside the windows for the
 * same reason: at the render where a window is gone, the layout has already
 * re-tiled without it, and the box it is drawn leaving from is the one it had
 * in the render before.
 *
 * A closing window is let go when it says so rather than when a timer here
 * does. How long it takes is the stylesheet's — see `closingStyles` — and a
 * duration written here as well would be a second copy of it to keep in step.
 */
export const useClosing = (
  windows: readonly ShellWindow[],
  placements: readonly Placement[],
): Closings => {
  const shown = useRef({ placements, windows });
  const [closing, setClosing] = useState<readonly Closing[]>([]);

  useEffect(() => {
    const gone = departed(
      shown.current.windows,
      windows,
      shown.current.placements,
    );
    shown.current = { placements, windows };
    if (gone.length > 0) {
      setClosing((playing) => [...playing, ...gone]);
    }
  }, [placements, windows]);

  const onGone = useCallback((id: string) => {
    setClosing((playing) =>
      playing.filter(({ placement }) => placement.id !== id),
    );
  }, []);

  return { closing, onGone };
};
