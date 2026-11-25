// Every shader effect manganese draws with, by the name its CSS gives
// `domicile-shader()`. `useShaderEffects` registers them as the shell starts.

import { FROST } from "@domicile-desktop/component-library/ModalDialog/frost";
import { WINDOW_EFFECTS } from "@domicile-desktop/manganese-window-management/window-effects";
import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

/**
 * Brings the new theme in behind a soft edge as the theme wipe plays (see
 * `panda.config.ts`). `progress` runs 0 (old theme) to 1 (new theme);
 * `downward` is 1 to come in from the top and 0 from the bottom.
 */
const THEME_WIPE = `uniform shader content;
uniform float2 size;
uniform float progress;
uniform float downward;

half4 main(float2 p) {
  float soft = size.y * 0.12;
  float along = downward > 0.5 ? p.y : size.y - p.y;
  // Past the far edge by the soft band at 1, so the band leaves the screen.
  float front = progress * (size.y + soft);
  return content.eval(p) * half(1.0 - smoothstep(front - soft, front, along));
}
`;

/** Every effect manganese draws with, by name. */
export const SHADER_EFFECTS: Readonly<
  Record<keyof typeof WINDOW_EFFECTS | "frost" | "theme-wipe", ShaderEffect>
> = {
  ...WINDOW_EFFECTS,
  frost: FROST,
  "theme-wipe": { sksl: THEME_WIPE },
};
