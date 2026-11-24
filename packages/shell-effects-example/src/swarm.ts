// Swarm: the window breaks into dark flecks that scatter off the screen.
//
//   filter: domicile-shader(swarm, <progress>)
//
// An instanced mesh: one quad per fleck, each showing its own cell of the
// window. `progress` runs from 0, whole, to 1, gone, on the compositor.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

export const SWARM = "swarm";

/** Flecks across and down the window. */
const COLUMNS = 48;
const ROWS = 30;

const VERTEX = `
uniform float2 size;
uniform float progress;

// A fixed number from 0 to 1 for each n.
float hash(float n) {
  return fract(sin(n * 12.9898) * 43758.5453);
}

Varyings main(const Attributes a) {
  float column = mod(a.index, ${COLUMNS.toString()}.0);
  float row = floor(a.index / ${COLUMNS.toString()}.0);
  float2 cell = size / float2(${COLUMNS.toString()}.0, ${ROWS.toString()}.0);
  float2 center = (float2(column, row) + 0.5) * cell;
  float r1 = hash(a.index);
  float r2 = hash(a.index + 17.0);
  float r3 = hash(a.index + 41.0);

  // Flecks leave at staggered times, then speed up.
  float t = clamp((progress - 0.35 * r1) / 0.65, 0.0, 1.0);
  float e = t * t;

  // Out from the window's center, scattered, falling a little.
  float angle = r2 * 6.2831853;
  float2 outward = (center - size * 0.5) / max(size.x, size.y);
  float2 direction =
      normalize(outward + 0.6 * float2(cos(angle), sin(angle)) + 0.0001);
  float travel = (0.4 + r3) * max(size.x, size.y);
  float2 drift = direction * travel * e + float2(0.0, 0.3 * size.y * e * e);

  // Each fleck grows a little past its cell, then shrinks and spins.
  float grow = mix(1.0, 1.5, smoothstep(0.0, 0.15, t)) * (1.0 - 0.5 * e);
  float spin = (r2 - 0.5) * 10.0 * e;
  float2 corner = (a.uv - 0.5) * cell * grow;
  float2 turned = float2(cos(spin) * corner.x - sin(spin) * corner.y,
                         sin(spin) * corner.x + cos(spin) * corner.y);

  Varyings v;
  v.position = center + turned + drift;
  v.uv = center + corner;
  v.data = float4(a.uv, t, r1);
  return v;
}
`;

const SKSL = `
uniform shader content;

float2 main(const Varyings v, out half4 color) {
  // A ragged blob, square while the fleck is still in place.
  float2 q = v.data.xy - 0.5;
  float t = v.data.z;
  float edge = 0.5 - 0.12 * (1.0 + sin(atan(q.y, q.x) * 3.0 + v.data.w * 40.0));
  float blob = 1.0 - smoothstep(edge - 0.05, edge, length(q));
  float inside = mix(1.0, blob, smoothstep(0.0, 0.15, t));

  half4 c = content.eval(v.uv);
  float dark = 0.8 * smoothstep(0.0, 0.5, t);
  float alpha = inside * (1.0 - smoothstep(0.7, 1.0, t));
  color = half4(float4(float3(c.rgb) * (1.0 - dark), float(c.a)) * alpha);
  return v.uv;
}
`;

/** The swarm effect. Its flecks fly as far as the screen's edge. */
export const swarm: ShaderEffect = {
  mesh: { instances: COLUMNS * ROWS },
  outset: "screen",
  sksl: SKSL,
  vertex: VERTEX,
};
