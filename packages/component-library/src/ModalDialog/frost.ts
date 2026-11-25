// Frosted glass behind a `surface="glass"` dialog: a shader effect a shell
// registers as `frost` (see docs/architecture/MOTION.md). The backdrop applies
// it after its blur while `<html>`'s `data-shader-effects` lists `frost`, and
// keeps its plain blur otherwise. A shell that lists `frost` sets
// `--device-pixel-ratio` on `<html>` to `devicePixelRatio`.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

/**
 * Fine grain and a faint sheen over the blurred desktop, as frosted glass
 * scatters light. `grain` scales both: 0 leaves the blur as it is. The grain
 * is made here, from a hash, so it needs no image. `scale` is the device
 * pixels to a CSS pixel, so a speck is a CSS pixel at every display scale.
 */
export const FROST: ShaderEffect = {
  sksl: `uniform shader content;
uniform float2 size;
uniform float grain;
uniform float scale;

float hash(float2 cell) {
  float3 p = fract(cell.xyx * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

half4 main(float2 p) {
  half4 color = content.eval(p);
  float speck = (hash(floor(p / scale)) - 0.5) * 0.06 * grain;
  // Lighter toward the top, as light falls on glass.
  float sheen = (1.0 - p.y / size.y) * 0.04 * grain;
  color.rgb = clamp(color.rgb + half(speck + sheen) * color.a, 0.0, color.a);
  return color;
}
`,
};
