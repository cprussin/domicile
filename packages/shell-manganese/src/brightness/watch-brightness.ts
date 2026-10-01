import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";

/**
 * Watch the screen's brightness: `onLevel` is called with the level, 0
 * through 1, as soon as the host has said one and again whenever the
 * backlight moves — a key, another program, or this shell's own slider — and
 * what comes back stops it. A machine with no backlight never calls it.
 */
export const watchBrightness = (
  domicile: DomicileClient,
  onLevel: (level: number) => void,
): (() => void) => {
  const handler = ({ level }: { level: number }) => {
    onLevel(level);
  };
  domicile.on("brightness", handler);
  return () => {
    domicile.off("brightness", handler);
  };
};
