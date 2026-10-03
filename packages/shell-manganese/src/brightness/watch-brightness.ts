import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";

import { watchShared } from "../host/watch-shared";

/**
 * Watch the screen's brightness: `onLevel` is called with the level, 0
 * through 1, as soon as the host has said one and again whenever the
 * backlight moves — a key, another program, or this shell's own slider — and
 * what comes back stops it. A machine with no backlight never calls it.
 *
 * Shared with every other bar on the page — see `watchShared`.
 */
export const watchBrightness = (
  domicile: DomicileClient,
  onLevel: (level: number) => void,
): (() => void) =>
  watchShared(domicile, "brightness", ({ level }) => {
    onLevel(level);
  });
