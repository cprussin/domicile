// The shader effects windows and the overview draw with, by the name their
// CSS gives `domicile-shader()`. The shell registers them; a motion applies
// one only while `<html>`'s `data-shader-effects` lists it. See
// docs/architecture/MOTION.md.
//
// `size` and `p` are in device pixels. Each effect takes `scale`, the device
// pixels to a CSS pixel, last, so the lengths its motion passes are in CSS
// pixels and it looks the same at every display scale. The motions pass
// `var(--device-pixel-ratio)`, which the shell sets.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

/**
 * Smears a window along a workspace switch's slide, `reach` CSS pixels each
 * way. It samples inside the element only, so the edges stay put.
 */
const SLIDE_BLUR = `uniform shader content;
uniform float2 size;
uniform float reach;
uniform float scale;

half4 main(float2 p) {
  half4 sum = half4(0.0);
  for (int i = 0; i < 9; i++) {
    float x = clamp(p.x + (float(i) - 4.0) / 4.0 * reach * scale, 0.5, size.x - 0.5);
    sum += content.eval(float2(x, p.y));
  }
  return sum / 9.0;
}
`;

/**
 * Throws the wallpaper out of focus behind the overview: a disc blur of
 * `radius` CSS pixels that widens toward the screen's edges, away from the
 * workspaces in the middle.
 */
const DEPTH_OF_FIELD = `uniform shader content;
uniform float2 size;
uniform float radius;
uniform float scale;

half4 main(float2 p) {
  float2 fromMiddle = p / size - 0.5;
  float reach = radius * scale * (0.6 + 1.6 * dot(fromMiddle, fromMiddle));
  half4 sum = content.eval(p);
  for (int i = 0; i < 24; i++) {
    // Spread over the disc on the golden angle, so no ring shows.
    float turn = float(i) * 2.39996;
    float away = sqrt((float(i) + 0.5) / 24.0) * reach;
    float2 at = clamp(p + float2(cos(turn), sin(turn)) * away, float2(0.5), size - 0.5);
    sum += content.eval(at);
  }
  return sum / 25.0;
}
`;

/** The window and overview effects, by name. */
export const WINDOW_EFFECTS: Readonly<
  Record<"depth-of-field" | "slide-blur", ShaderEffect>
> = {
  "depth-of-field": { sksl: DEPTH_OF_FIELD },
  "slide-blur": { sksl: SLIDE_BLUR },
};
