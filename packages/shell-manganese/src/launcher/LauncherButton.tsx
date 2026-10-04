import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";

import { css } from "../../styled-system/css";

type Props = {
  /** Opens the launcher. */
  onOpen: () => void;
};

/** The bar's launcher button, the pointer equivalent of `mod+Space`. */
export const LauncherButton = ({ onOpen }: Props) => (
  <button
    aria-label="Launcher"
    className={buttonStyles}
    onClick={onOpen}
    title="Launcher"
    type="button"
  >
    <SquaresFourIcon aria-hidden size={15} />
  </button>
);

// Styled like the bell button. The negative margin cancels the bar's start
// column `gap: 4`, so the tray sits right after the button.
const buttonStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  marginInlineEnd: -4,
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});
