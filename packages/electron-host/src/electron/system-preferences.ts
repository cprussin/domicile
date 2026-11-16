// The stand-in for Electron's `systemPreferences` on Linux: its animation
// settings, and the accent color, which Domicile's desktop doesn't set.

import { EventEmitter } from "node:events";

export const createSystemPreferences = (reducedMotion: () => boolean) =>
  Object.assign(new EventEmitter(), {
    getAccentColor: () => "",
    getAnimationSettings: () => ({
      prefersReducedMotion: reducedMotion(),
      scrollAnimationsEnabledBySystem: !reducedMotion(),
      shouldRenderRichAnimations: !reducedMotion(),
    }),
  });
