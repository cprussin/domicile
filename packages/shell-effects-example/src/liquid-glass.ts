// Liquid glass: a panel that bends what is behind it at its rounded rim,
// splits the colors a little there, and catches a highlight on its top-left
// edge.
//
//   backdrop-filter: blur(6px) domicile-shader(liquid-glass, <radius>,
//     <bevel>, <strength>, <dispersion>, <scale>);
//
// - `radius`: the panel's corner radius in CSS pixels, as its `border-radius`.
// - `bevel`: how far in from the edge the glass bends, in CSS pixels.
// - `strength`: how far the edge reads from, outward, in CSS pixels.
// - `dispersion`: how far the colors split, 0 to 1.
// - `scale`: the page's `devicePixelRatio`. `p` and `size` are device pixels.
//
// A fragment effect over the backdrop. The rim reads the backdrop outside the
// panel, so its outset is at least the farthest it reads.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

import { domicileShader } from "./filter";

export const LIQUID_GLASS = "liquid-glass";

const SKSL = `
uniform shader content;
uniform float2 size;
uniform float radius;
uniform float bevel;
uniform float strength;
uniform float dispersion;
uniform float scale;

// Distance to the panel's rounded edge, negative inside, in device pixels.
float edge(float2 p) {
  float r = radius * scale;
  float2 q = abs(p - size * 0.5) - size * 0.5 + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 p) {
  float d = edge(p);
  // Outward, across the edge.
  float2 normal = normalize(float2(edge(p + float2(1.0, 0.0)) - edge(p - float2(1.0, 0.0)),
                                   edge(p + float2(0.0, 1.0)) - edge(p - float2(0.0, 1.0))) +
                            0.00001);
  // 1 at the edge, 0 a bevel in: a lens's curve.
  float rim = clamp(1.0 + d / max(bevel * scale, 1.0), 0.0, 1.0);
  float bend = rim * rim * strength * scale;
  float split = dispersion * bend * 0.2;

  half4 green = content.eval(p + normal * bend);
  half red = content.eval(p + normal * (bend + split)).r;
  half blue = content.eval(p + normal * (bend - split)).b;

  // A highlight along the top-left rim.
  float light = rim * rim * rim * max(dot(normal, float2(-0.7071, -0.7071)), 0.0) * 0.35;
  float3 rgb = float3(red, green.g, blue) * 1.04 + light * float(green.a);
  return half4(float4(rgb, float(green.a)));
}
`;

/** The liquid glass effect, for `backdrop-filter`. */
export const liquidGlass: ShaderEffect = { outset: 32, sksl: SKSL };

/**
 * The bar's `backdrop-filter` at `scale`, the page's `devicePixelRatio`: a
 * frost, then the glass with the bar's 18px `border-radius`.
 */
export const glassFilter = (scale: number): string =>
  `blur(6px) ${domicileShader(LIQUID_GLASS, 18, 22, 24, 1, scale)}`;
