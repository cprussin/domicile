// What plays on a closed window. The engine keeps a closed window's last
// frame while its `<app>` stays in the page, up to 10 s, so the shell keeps
// the `<app>`, plays one of these on it, then removes it.

import type { RegisteredEffect } from "@domicile-desktop/sdk/desktop/effects";

import { CLOTH, CLOTH_GRID } from "./cloth";
import type { Cloth } from "./cloth-simulation";
import { clothArrays, restingCloth, stepCloth } from "./cloth-simulation";
import { domicileShader } from "./filter";
import type { Registered } from "./register";
import { SMOKE } from "./smoke";
import { SWARM } from "./swarm";

/** The effects a window can close with. */
export type CloseEffect = typeof SMOKE | typeof CLOTH | typeof SWARM;

export const CLOSE_EFFECTS: readonly CloseEffect[] = [SMOKE, CLOTH, SWARM];

/** Runs `callback` before the next frame, with that frame's time in ms. */
export type NextFrame = (callback: (time: number) => void) => void;

/** How long each takes, in ms: well inside the engine's 10 s. */
const DURATIONS: Readonly<Record<CloseEffect, number>> = {
  cloth: 1400,
  smoke: 900,
  swarm: 1100,
};

/** One 60 Hz frame, in seconds. */
const FRAME = 1 / 60;

/**
 * Plays `kind` on `app`, a closed window's `<app>`, and resolves when it
 * has. `scale` is the page's `devicePixelRatio`, for the effects that
 * measure CSS pixels. The smoke and the swarm run on the compositor; the
 * cloth also sets its points from the main thread each frame.
 */
export const playClose = (
  app: Element,
  kind: CloseEffect,
  registered: Registered,
  scale: number,
  nextFrame: NextFrame = requestNextFrame,
): Promise<void> => {
  switch (kind) {
    case SMOKE:
      return playProgress(app, kind, [scale]);
    case SWARM:
      return playProgress(app, kind, []);
    case CLOTH:
      return playCloth(app, effectNamed(registered, CLOTH), scale, nextFrame);
  }
};

/** Animates the effect's first argument from 0 to 1, with `rest` after it. */
const playProgress = async (
  app: Element,
  kind: CloseEffect,
  rest: readonly number[],
): Promise<void> => {
  // One effect in every keyframe keeps the outset, so this runs on the
  // compositor.
  await app.animate(
    [
      { filter: domicileShader(kind, 0, ...rest) },
      { filter: domicileShader(kind, 1, ...rest) },
    ],
    { duration: DURATIONS[kind], easing: "ease-in", fill: "forwards" },
  ).finished;
};

/** Simulates the sheet each frame while the fade runs. */
const playCloth = async (
  app: Element,
  effect: RegisteredEffect,
  scale: number,
  nextFrame: NextFrame,
): Promise<void> => {
  // The sheet moves in CSS pixels; the vertex program scales its points.
  const box = app.getBoundingClientRect();
  const fade = app.animate(
    [
      { filter: domicileShader(CLOTH, 0, scale) },
      { filter: domicileShader(CLOTH, 0, scale), offset: 0.55 },
      { filter: domicileShader(CLOTH, 1, scale) },
    ],
    { duration: DURATIONS.cloth, fill: "forwards" },
  );
  const state = { done: false };
  const flap = (cloth: Cloth, last: number | undefined) => (time: number) => {
    if (!state.done) {
      const seconds =
        last === undefined ? FRAME : Math.min((time - last) / 1000, 2 * FRAME);
      const next = stepCloth(cloth, seconds);
      effect.update(app, { points: clothArrays(next) }).match({
        None: () => undefined,
        Some: (why) => {
          throw new Error(`cloth: ${why}`);
        },
      });
      nextFrame(flap(next, time));
    }
  };
  nextFrame(
    flap(
      restingCloth(CLOTH_GRID.columns, CLOTH_GRID.rows, box.width, box.height),
      undefined,
    ),
  );
  await fade.finished;
  state.done = true;
};

/** Effect `name`, which `registerEffects` registered. */
const effectNamed = (
  registered: Registered,
  name: string,
): RegisteredEffect => {
  const effect = registered.get(name);
  if (effect === undefined) {
    throw new Error(`effect ${name} is not registered`);
  } else {
    return effect;
  }
};

const requestNextFrame: NextFrame = (callback) => {
  requestAnimationFrame(callback);
};
