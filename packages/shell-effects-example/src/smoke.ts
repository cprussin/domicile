// Smoke: the window burns to dark smoke that rises, swirls and thins.
//
//   filter: domicile-shader(smoke, <progress>, <scale>)
//
// - `progress` runs from 0, the window as it is, to 1, gone.
// - `scale` is the page's `devicePixelRatio`. `p` and `size` are device
//   pixels; the blur and the swirl measure CSS pixels, so they look the same
//   at any scale.
//
// A fragment effect
// over the whole screen (`outset: "screen"`), since the smoke drifts out of
// the window's box. The swirl comes from a tiling noise image.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

export const SMOKE = "smoke";

/** The smoke effect, sampling the noise image at `noise`. */
export const smoke = (noise: string): ShaderEffect => ({
  images: { noise },
  outset: "screen",
  sksl: SKSL,
});

const SKSL = `
uniform shader content;
uniform shader noise;
uniform float2 size;
uniform float progress;
uniform float scale;

// Two octaves of the noise at p in CSS pixels, each channel -1 to 1,
// drifting with t.
float2 swirl(float2 p, float t) {
  half4 slow = noise.eval(p * 0.35 + float2(0.0, 160.0 * t));
  half4 fine = noise.eval(p * 1.1 - float2(90.0 * t, 0.0));
  return (float2(slow.r, slow.g) * 2.0 - 1.0) +
         0.5 * (float2(fine.g, fine.b) * 2.0 - 1.0);
}

half4 main(float2 p) {
  float t = clamp(progress, 0.0, 1.0);
  float reach = max(size.x, size.y);
  float2 center = size * 0.5;
  float2 css = p / scale;

  // Where the smoke over p came from: nearer the center as it spreads,
  // below p as it rises, and pulled about by the swirl.
  float2 from = center + (p - center) / (1.0 + 0.8 * t);
  from += float2(0.0, 0.45 * reach * t * t);
  from -= swirl(css, t) * 0.25 * reach * t;

  // Softer as it thins: a ring of taps that widens with t.
  float blur = 24.0 * scale * t;
  half4 c = content.eval(from);
  for (int i = 0; i < 6; i++) {
    float angle = float(i) * 1.0471976;
    c += content.eval(from + blur * float2(cos(angle), sin(angle)));
  }
  c /= 7.0;

  // It darkens to smoke, then thins where the noise is thin.
  float dark = smoothstep(0.0, 0.35, t);
  float3 rgb = mix(float3(c.rgb), float3(0.05, 0.05, 0.06) * float(c.a), dark);
  float density = float(noise.eval(css * 0.6 + float2(0.0, 220.0 * t)).b);
  float alpha = clamp((1.0 - t) * 1.4 - (1.0 - density) * t * 1.2, 0.0, 1.0);
  return half4(float4(rgb, float(c.a)) * alpha);
}
`;
