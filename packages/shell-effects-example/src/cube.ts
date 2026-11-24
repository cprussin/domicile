// The workspace cube: four workspaces on the faces of a cube that turns to
// the one shown, seen from outside or from inside. The cube is CSS 3D
// transforms; the `cube-face` effect darkens each face as it turns away.
//
//   filter: domicile-shader(cube-face, <light>)
//
// `light` runs from 0, a face edge on, to 1, a face toward the viewer.

import type { ShaderEffect } from "@domicile-desktop/sdk/desktop/effects";

export const CUBE_FACE = "cube-face";

/** Which side of the faces the viewer is on. */
export type CubeSide = "outside" | "inside";

const SKSL = `
uniform shader content;
uniform float2 size;
uniform float light;

half4 main(float2 p) {
  half4 c = content.eval(p);
  // Darker toward the corners as the face turns away.
  float2 q = p / size - 0.5;
  float shade = mix(0.3, 1.0, light) * (1.0 - (1.0 - light) * dot(q, q));
  return half4(float4(float3(c.rgb) * shade, float(c.a)));
}
`;

/** The face shading. It draws only inside the face. */
export const cubeFace: ShaderEffect = { outset: 0, sksl: SKSL };

/** Where workspace `face` sits on a cube `width` wide. */
export const faceTransform = (
  face: number,
  width: number,
  side: CubeSide,
): string =>
  `rotateY(${(face * 90).toString()}deg) translateZ(${((sideSign(side) * width) / 2).toString()}px)`;

/** The cube turned `angle` degrees, its shown face in the page's plane. */
export const cubeTransform = (
  angle: number,
  width: number,
  side: CubeSide,
): string =>
  `translateZ(${((-sideSign(side) * width) / 2).toString()}px) rotateY(${angle.toString()}deg)`;

/** The turn from `angle` that shows workspace `face`, the short way. */
export const turnTo = (angle: number, face: number): number => {
  const shown = -face * 90;
  return shown + 360 * Math.round((angle - shown) / 360);
};

/** The `light` of workspace `face` with the cube turned `angle` degrees. */
export const faceLight = (face: number, angle: number): number =>
  Math.max(Math.cos(((face * 90 + angle) * Math.PI) / 180), 0);

const sideSign = (side: CubeSide): number => {
  switch (side) {
    case "outside":
      return 1;
    case "inside":
      return -1;
  }
};
