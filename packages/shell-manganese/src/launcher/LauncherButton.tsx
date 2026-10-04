import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";

import { css } from "../../styled-system/css";

type Props = {
  /** Open the launcher. */
  onOpen: () => void;
};

/**
 * The button at the bar's far start: the launcher, for a hand already on the
 * pointer. `mod+Space` is the same panel.
 */
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

// The bell's shape: a round, borderless control in the bar's own white, lit on
// hover. The margin takes back the bar's own gap (its start column's `gap: 4`),
// so the tray starts right after the button.
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
