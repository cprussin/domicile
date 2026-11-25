import { describe, expect, it } from "bun:test";

import { windowManagementPreset } from "./panda-preset";
import { WINDOW_EFFECTS } from "./window-effects";

/**
 * The uniforms an effect's SkSL declares, in order, after the child
 * `content` and `size` the engine sets.
 */
const takes = (sksl: string): readonly string[] => {
  const [content, size, ...numbers] = [
    ...sksl.matchAll(/^uniform (\w+) (\w+);$/gm),
  ].map(([, type, name]) => `${type ?? ""} ${name ?? ""}`);
  expect([content, size]).toStrictEqual(["shader content", "float2 size"]);
  return numbers;
};

/** Each `domicile-shader()` in `css`: the effect's name and its arguments. */
const shaded = (css: string) =>
  [...css.matchAll(/domicile-shader\(((?:[^()]|\([^()]*\))*)\)/g)].map(
    ([, args]) => {
      const [name, ...numbers] = (args ?? "")
        .split(",")
        .map((arg) => arg.trim());
      return { name, numbers };
    },
  );

describe("window effects", () => {
  it("take the numbers their motions pass", () => {
    expect(
      Object.fromEntries(
        Object.entries(WINDOW_EFFECTS).map(([name, { sksl }]) => [
          name,
          takes(sksl),
        ]),
      ),
    ).toStrictEqual({
      "depth-of-field": ["float radius", "float scale"],
      dissolve: [
        "float progress",
        "float originX",
        "float originY",
        "float scale",
      ],
      "slide-blur": ["float reach", "float scale"],
    });
  });

  // An effect with an outset moves pixels, so the engine runs its animation
  // on the main thread.
  it("draw only inside their element", () => {
    expect(
      Object.values(WINDOW_EFFECTS).map(({ outset }) => outset ?? 0),
    ).toStrictEqual([0, 0, 0]);
  });

  // `size` and `p` are in device pixels, and every length a motion passes
  // is in CSS pixels, so each effect is passed the ratio between them last.
  it("are passed as many numbers as they take by every keyframe, the pixel ratio last", () => {
    const calls = shaded(
      JSON.stringify(windowManagementPreset.theme?.extend?.keyframes),
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const { name, numbers } of calls) {
      const effect = WINDOW_EFFECTS[name as keyof typeof WINDOW_EFFECTS];
      expect(numbers).toHaveLength(takes(effect.sksl).length);
      expect(numbers.at(-1)).toBe("var(--device-pixel-ratio)");
    }
  });
});
