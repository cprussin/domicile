import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";
import type { RegisteredEffect } from "@domicile-desktop/sdk/desktop/effects";
import type { NextFrame } from "./close";
import { playClose } from "./close";
import { CLOTH, CLOTH_GRID } from "./cloth";

type Animated = [keyframes: Keyframe[], options: KeyframeAnimationOptions];

/** An `<app>` whose animations finish when the test says. */
const fakeApp = () => {
  const animations: Animated[] = [];
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const app = {
    animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      animations.push([keyframes, options]);
      return { finished };
    },
    getBoundingClientRect: () => ({ height: 600, width: 800 }),
  } as unknown as Element;
  return { animations, app, finish };
};

/** Frames the test runs one at a time. */
const fakeFrames = () => {
  const queued: Parameters<NextFrame>[0][] = [];
  const nextFrame: NextFrame = (callback) => {
    queued.push(callback);
  };
  const run = (time: number) => {
    queued.shift()?.(time);
  };
  return { nextFrame, queued, run };
};

/** The cloth effect, recording the arrays it is given. */
const recordingCloth = (why?: string) => {
  const updates: number[] = [];
  const effect: RegisteredEffect = {
    arguments: 1,
    update: (_, arrays) => {
      updates.push(arrays.points?.length ?? 0);
      return why === undefined ? None() : Some(why);
    },
  };
  return { effects: new Map([[CLOTH, effect]]), updates };
};

describe("playClose", () => {
  describe.each([
    ["smoke", ", 2"],
    ["swarm", ""],
  ] as const)("%s", (kind, scale) => {
    it("animates its progress from 0 to 1 on the compositor", async () => {
      const { animations, app, finish } = fakeApp();

      const played = playClose(app, kind, new Map(), 2);
      finish();
      await played;

      expect(animations).toEqual([
        [
          [
            { filter: `domicile-shader(${kind}, 0${scale})` },
            { filter: `domicile-shader(${kind}, 1${scale})` },
          ],
          expect.objectContaining({ fill: "forwards" }),
        ],
      ]);
    });
  });

  describe("cloth", () => {
    const POINTS = 4 * (CLOTH_GRID.columns + 1) * (CLOTH_GRID.rows + 1);

    it("fades the cloth with the same effect in every keyframe", () => {
      const { animations, app } = fakeApp();
      playClose(
        app,
        "cloth",
        recordingCloth().effects,
        2,
        () => undefined,
      ).catch(() => undefined);

      const filters = animations[0]?.[0].map((frame) => frame.filter);
      expect(filters?.[0]).toBe("domicile-shader(cloth, 0, 2)");
      expect(filters?.at(-1)).toBe("domicile-shader(cloth, 1, 2)");
      expect(
        filters?.every((filter) =>
          String(filter).startsWith("domicile-shader(cloth,"),
        ),
      ).toBe(true);
    });

    it("sets the simulated points every frame until the fade ends", async () => {
      const { app, finish } = fakeApp();
      const { effects, updates } = recordingCloth();
      const frames = fakeFrames();

      const played = playClose(app, "cloth", effects, 2, frames.nextFrame);
      frames.run(0);
      frames.run(16);
      frames.run(33);
      finish();
      await played;
      frames.run(50);

      expect(updates).toEqual([POINTS, POINTS, POINTS]);
      expect(frames.queued).toEqual([]);
    });

    it("throws when the engine will not take the points", () => {
      const { app } = fakeApp();
      const frames = fakeFrames();
      playClose(
        app,
        "cloth",
        recordingCloth("array points holds 1700 floats").effects,
        2,
        frames.nextFrame,
      ).catch(() => undefined);

      expect(() => frames.run(0)).toThrow(
        "cloth: array points holds 1700 floats",
      );
    });
  });
});
