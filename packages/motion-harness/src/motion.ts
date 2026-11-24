import type { ComponentType } from "react";

/**
 * A scene's two states. Playing a motion flips `played`; playing it again
 * flips it back, which plays the motion in reverse, such as a close after an
 * open.
 */
export type SceneProps = { played: boolean };

/** One of manganese's motions, as the harness and the slowed page play it. */
export type Motion = {
  /** Names it in the harness's command line and the story's `motion` arg. */
  id: string;
  name: string;
  /** Draws it from the top left of the viewport, 960x540. */
  Scene: ComponentType<SceneProps>;
};
