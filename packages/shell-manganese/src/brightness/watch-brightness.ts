import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";

import { watchShared } from "../host/watch-shared";

/**
 * Watches the backlight: calls `onLevel` with each level (0 to 1) the host
 * reports, and returns a function that stops watching. Never called on a
 * machine without a backlight.
 *
 * Shared by every bar on the page; see `watchShared`.
 */
export const watchBrightness = (
  domicile: DomicileClient,
  onLevel: (level: number) => void,
): (() => void) =>
  watchShared(domicile, "brightness", ({ level }) => {
    onLevel(level);
  });
