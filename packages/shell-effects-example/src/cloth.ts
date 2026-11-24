// Cloth: the window flaps loose from its top edge and blows away like a sheet.
//
//   filter: domicile-shader(cloth, <fade>, <scale>)
//
// A grid mesh. `cloth-simulation.ts` moves the grid's points on the main
// thread and hands them to the effect with `update(app, { points })` each
// frame. `fade` runs from 0 to 1 on the compositor as the sheet leaves.
// `scale` is the page's `devicePixelRatio`: the points are CSS pixels, and the
// vertex program scales them to the pass's device pixels.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

export const CLOTH = "cloth";

/** The mesh: cells across and down. */
export const CLOTH_GRID = { columns: 24, rows: 16 } as const;

/** Grid points, one more than cells each way. */
const POINTS = (CLOTH_GRID.columns + 1) * (CLOTH_GRID.rows + 1);

// Each point is a float4: its offset from where it rests, and its shade.
// Strict ES2 indexes an array only with a constant or a loop counter, so the
// vertex finds its point with a loop.
const VERTEX = `
uniform float2 size;
uniform float fade;
uniform float scale;
uniform float4 points[${POINTS}];

Varyings main(const Attributes a) {
  float4 point = float4(0.0);
  for (int i = 0; i < ${POINTS}; i++) {
    if (float(i) == a.index) {
      point = points[i];
    }
  }
  Varyings v;
  v.position = a.uv * size + point.xy * scale;
  v.uv = a.uv * size;
  v.data = float4(point.z, fade, 0.0, 0.0);
  return v;
}
`;

const SKSL = `
uniform shader content;

float2 main(const Varyings v, out half4 color) {
  half4 c = content.eval(v.uv);
  float shade = 1.0 - v.data.x;
  float alpha = 1.0 - v.data.y;
  color = half4(float4(float3(c.rgb) * shade, float(c.a)) * alpha);
  return v.uv;
}
`;

/** The cloth effect. It draws as far as the screen, where the sheet blows. */
export const cloth: ShaderEffect = {
  mesh: { grid: [CLOTH_GRID.columns, CLOTH_GRID.rows] },
  outset: "screen",
  sksl: SKSL,
  vertex: VERTEX,
};
