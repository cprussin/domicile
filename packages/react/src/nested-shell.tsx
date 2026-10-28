// Another shell, run inside this one.

import type { Shell } from "@domicile-desktop/sdk/shell";
import { useCallback, useRef } from "react";

import { useDomicile } from "./domicile-provider";

/**
 * Runs `shell` in an element of its own, on the desktop above. The element has
 * `display: contents`, so the shell sizes against wherever this is placed.
 *
 * A `Shell` runs once and can't be undone, so this runs it once, when the
 * element is first attached. React passes `null` when it detaches. It runs
 * after React's commit, since a shell may draw synchronously, as `mount` does.
 */
export const NestedShell = ({ shell }: { shell: Shell }) => {
  const domicile = useDomicile();
  const ran = useRef(false);

  const start = useCallback(
    (element: HTMLDivElement | null) => {
      if (element !== null && !ran.current) {
        ran.current = true;
        queueMicrotask(() => shell(element, domicile));
      }
    },
    [shell, domicile],
  );

  return <div ref={start} style={{ display: "contents" }} />;
};
