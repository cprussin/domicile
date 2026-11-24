// What the engine checks when it compiles each effect, checked here on the
// source: the uniforms it lays out, its mesh and its limits. The SkSL itself
// compiles only in the engine.

import { describe, expect, it } from "bun:test";
import type {
  ShaderEffect,
  ShaderEffectMesh,
} from "@domicile-desktop/sdk/desktop/effects";

import { CLOTH, CLOTH_GRID, cloth } from "./cloth";
import { clothArrays, restingCloth } from "./cloth-simulation";
import { CUBE_FACE, cubeFace } from "./cube";
import { LIQUID_GLASS, liquidGlass } from "./liquid-glass";
import { SMOKE, smoke } from "./smoke";
import { SWARM, swarm } from "./swarm";

/** The most floats an effect takes after `size`, outside arrays. */
const MAX_ARGUMENTS = 16;
/** The most floats an element's arrays hold: 64 KiB. */
const MAX_ARRAY_FLOATS = 16 * 1024;
/** The most cells or instances in a mesh. */
const MAX_MESH = 16 * 1024;
/** The longest program, in bytes. */
const MAX_SOURCE = 32 * 1024;

type Expected = {
  name: string;
  effect: ShaderEffect;
  mesh: ShaderEffectMesh | undefined;
  outset: number | "screen";
  arguments: readonly string[];
  arrays: Readonly<Record<string, number>>;
  images: readonly string[];
};

const EFFECTS: readonly Expected[] = [
  {
    arguments: ["progress", "scale"],
    arrays: {},
    effect: smoke("noise.png"),
    images: ["noise"],
    mesh: undefined,
    name: SMOKE,
    outset: "screen",
  },
  {
    arguments: ["fade", "scale"],
    arrays: {
      points: clothArrays(
        restingCloth(CLOTH_GRID.columns, CLOTH_GRID.rows, 640, 480),
      ).length,
    },
    effect: cloth,
    images: [],
    mesh: { grid: [CLOTH_GRID.columns, CLOTH_GRID.rows] },
    name: CLOTH,
    outset: "screen",
  },
  {
    arguments: ["progress"],
    arrays: {},
    effect: swarm,
    images: [],
    mesh: { instances: 48 * 30 },
    name: SWARM,
    outset: "screen",
  },
  {
    arguments: ["radius", "bevel", "strength", "dispersion", "scale"],
    arrays: {},
    effect: liquidGlass,
    images: [],
    mesh: undefined,
    name: LIQUID_GLASS,
    outset: 32,
  },
  {
    arguments: ["light"],
    arrays: {},
    effect: cubeFace,
    images: [],
    mesh: undefined,
    name: CUBE_FACE,
    outset: 0,
  },
];

describe.each(EFFECTS)("$name", (expected) => {
  const { effect } = expected;
  const uniforms = uniformsOf(effect);

  it("starts its uniforms with the element's size", () => {
    expect(uniforms[0]).toEqual({ floats: 2, name: "size", type: "float2" });
  });

  it("takes the arguments its CSS function passes, in order", () => {
    const taken = uniforms
      .slice(1)
      .filter((uniform) => uniform.length === undefined);
    expect(taken.map((uniform) => uniform.name)).toEqual([
      ...expected.arguments,
    ]);
    expect(
      taken.reduce((sum, uniform) => sum + uniform.floats, 0),
    ).toBeLessThanOrEqual(MAX_ARGUMENTS);
  });

  it("takes arrays that fit an element's 64 KiB", () => {
    const arrays = uniforms.filter((uniform) => uniform.length !== undefined);
    expect(
      Object.fromEntries(arrays.map((array) => [array.name, array.floats])),
    ).toEqual(expected.arrays);
    expect(
      arrays.reduce((sum, array) => sum + array.floats, 0),
    ).toBeLessThanOrEqual(MAX_ARRAY_FLOATS);
  });

  it("samples the content and its images, and nothing else", () => {
    expect(childrenOf(effect)).toEqual(["content", ...expected.images]);
    expect(Object.keys(effect.images ?? {})).toEqual([...expected.images]);
  });

  it("draws through its mesh, with a vertex program only when it has one", () => {
    expect(effect.mesh).toEqual(expected.mesh);
    expect(effect.vertex !== undefined).toBe(expected.mesh !== undefined);
    expect(meshSize(effect.mesh)).toBeLessThanOrEqual(MAX_MESH);
  });

  it("draws as far outside the element as it needs", () => {
    expect(effect.outset ?? 0).toEqual(expected.outset);
  });

  it("fits the engine's source limit", () => {
    expect(effect.sksl.length).toBeLessThanOrEqual(MAX_SOURCE);
    expect((effect.vertex ?? "").length).toBeLessThanOrEqual(MAX_SOURCE);
  });

  it("is a mesh fragment program when it has a mesh, else a fragment effect", () => {
    expect(effect.sksl).toMatch(
      expected.mesh === undefined
        ? /half4 main\(float2 p\)/
        : /float2 main\(const Varyings v, out half4 color\)/,
    );
  });
});

type Uniform = {
  name: string;
  type: string;
  floats: number;
  length?: number;
};

const FLOATS: Readonly<Record<string, number>> = {
  float: 1,
  float2: 2,
  float3: 3,
  float4: 4,
};

const UNIFORM = /uniform\s+(\w+)\s+(\w+)\s*(?:\[(\d+)\])?\s*;/g;

/**
 * The effect's float uniforms as the engine lays them out: the vertex
 * program's first, then those only the fragment program declares.
 */
const uniformsOf = (effect: ShaderEffect): Uniform[] => {
  const seen = new Map<string, Uniform>();
  for (const source of [effect.vertex ?? "", effect.sksl]) {
    for (const [, type = "", name = "", length] of source.matchAll(UNIFORM)) {
      const floats = FLOATS[type];
      if (floats !== undefined && !seen.has(name)) {
        seen.set(
          name,
          length === undefined
            ? { floats, name, type }
            : {
                floats: floats * Number(length),
                length: Number(length),
                name,
                type,
              },
        );
      }
    }
  }
  return [...seen.values()];
};

/** The `uniform shader` children the effect's programs declare. */
const childrenOf = (effect: ShaderEffect): string[] =>
  [...`${effect.vertex ?? ""}${effect.sksl}`.matchAll(UNIFORM)]
    .filter(([, type]) => type === "shader")
    .map(([, , name = ""]) => name);

const meshSize = (mesh: ShaderEffectMesh | undefined): number => {
  if (mesh === undefined) {
    return 0;
  } else if ("grid" in mesh) {
    return mesh.grid[0] * mesh.grid[1];
  } else {
    return mesh.instances;
  }
};
