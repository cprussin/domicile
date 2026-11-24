import { Button } from "@domicile-desktop/component-library/Button";
import { useEffect, useState } from "react";

import { css } from "../styled-system/css";
import type { Motion } from "./motion";
import { slowEveryAnimation } from "./slowed";

type Props = {
  motion: Motion;
  /** How fast every animation on the page plays; 1 is as shipped. */
  speed: number;
};

/**
 * `motion`'s scene, and a button that plays it forward and back at `speed`.
 * The harness presses the button.
 */
export const MotionPlayer = ({ motion: { name, Scene }, speed }: Props) => {
  const [played, setPlayed] = useState(false);
  // At full speed, nothing reads the animations each frame, so the harness
  // traces the page as it ships.
  useEffect(
    () => (speed === 1 ? undefined : slowEveryAnimation(speed)),
    [speed],
  );
  return (
    <>
      <div className={sceneStyles} data-motion-scene="">
        <Scene played={played} />
      </div>
      <div className={controlsStyles}>
        <Button
          onClick={() => {
            setPlayed(!played);
          }}
          variant="outline"
        >
          {played ? `Play ${name} back` : `Play ${name}`}
        </Button>
      </div>
    </>
  );
};

// The scenes' 960x540 screen, which clips their parts.
const sceneStyles = css({
  backgroundColor: "card",
  blockSize: 135,
  contain: "strict",
  inlineSize: 240,
  position: "relative",
});

const controlsStyles = css({ padding: 4 });
