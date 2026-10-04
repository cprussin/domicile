import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/**
 * Watch the screen's brightness: `onLevel` is called with the level, 0
 * through 1, as soon as the host has said one and again whenever the
 * backlight moves — a key, another program, or this shell's own slider — and
 * what comes back stops it. A machine with no backlight never calls it.
 */
export const watchBrightness = (
  domicile: DomicileHost,
  onLevel: (level: number) => void,
): (() => void) => watchHost(domicile, "brightnesschanged", levelOf, onLevel);

const levelOf = ({ brightness }: DomicileHost): number | undefined =>
  brightness ?? undefined;
