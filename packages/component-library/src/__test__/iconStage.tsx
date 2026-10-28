import type { Decorator } from "@storybook/react-vite";

import { css } from "../../styled-system/css";

/**
 * Puts an animated icon's story in a button, since its hover motion plays
 * while the control it is in is pointed at.
 */
export const iconStage: Decorator = (Story) => (
  <button className={stageStyles} type="button">
    <Story />
  </button>
);

const stageStyles = css({
  _hover: { backgroundColor: "fillHover" },
  alignItems: "center",
  backgroundColor: "fill",
  blockSize: 16,
  borderRadius: "lg",
  borderStyle: "none",
  color: "foreground",
  cursor: "pointer",
  display: "inline-flex",
  inlineSize: 16,
  justifyContent: "center",
});
