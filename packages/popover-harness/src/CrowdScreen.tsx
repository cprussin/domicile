import { css } from "../styled-system/css";
import type { Crowd } from "./crowd";

/**
 * `crowd`'s scene on a 1024x600 laptop screen at the top left of a desk that
 * spans a taller monitor too, as one page for the desk does. The harness opens
 * its panel.
 */
export const CrowdScreen = ({ crowd: { Scene } }: { crowd: Crowd }) => (
  <div className={deskStyles}>
    <div className={screenStyles} data-crowd-scene="" data-screen="laptop">
      <Scene />
    </div>
  </div>
);

// The desk: the laptop, and a monitor beside it filling the rest.
const deskStyles = css({
  backgroundColor: "gray.300",
  blockSize: "100vh",
  inlineSize: "100vw",
});

// The laptop's screen, where the bar's panels must stay. Not positioned
// inside the desk, as a `<Screen>` region isn't.
const screenStyles = css({
  backgroundColor: "gray.500",
  blockSize: "600px",
  inlineSize: "1024px",
  insetBlockStart: 0,
  insetInlineStart: 0,
  position: "absolute",
});
