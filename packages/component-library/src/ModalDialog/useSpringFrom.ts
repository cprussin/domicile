import { useCallback } from "react";
import { originOffset } from "./origin-offset";

/**
 * A ref for a popup that springs from `origin`: sets `--origin-x` and
 * `--origin-y` on it as it mounts, how far it moves to sit on `origin`. The
 * popup starts out scaled about its middle, which scaling leaves in place, so
 * measuring it then gives where it lands.
 */
export const useSpringFrom = (origin: Element | undefined) =>
  useCallback(
    (popup: HTMLElement | null) => {
      if (popup !== null && origin !== undefined) {
        const { x, y } = originOffset(
          popup.getBoundingClientRect(),
          origin.getBoundingClientRect(),
        );
        popup.style.setProperty("--origin-x", `${String(x)}px`);
        popup.style.setProperty("--origin-y", `${String(y)}px`);
      }
    },
    [origin],
  );
