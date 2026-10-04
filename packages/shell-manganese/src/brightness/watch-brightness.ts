import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/**
 * Watches the backlight: calls `onLevel` with the current level (0 to 1) and
 * each one after, and returns a function that stops watching. Never called on
 * a machine without a backlight.
 */
export const watchBrightness = (
  domicile: DomicileHost,
  onLevel: (level: number) => void,
): (() => void) => watchHost(domicile, "brightnesschanged", levelOf, onLevel);

const levelOf = ({ brightness }: DomicileHost): number | undefined =>
  brightness ?? undefined;
