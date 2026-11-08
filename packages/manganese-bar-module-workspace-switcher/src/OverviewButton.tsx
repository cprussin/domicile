import { AnimatedSquaresIcon } from "@domicile-desktop/component-library/AnimatedSquaresIcon";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";

import { css } from "../styled-system/css";

type Props = {
  /** Opens or closes the overview. */
  onToggle: () => void;
  /** Whether the overview is open, which keeps the button lit. */
  open: boolean;
};

/**
 * The switcher's overview button, the pointer equivalent of Meta+O: each
 * screen's workspaces at once.
 */
export const OverviewButton = ({ onToggle, open }: Props) => (
  <Tooltip
    content="Overview"
    tone="overPhoto"
    trigger={
      <button
        aria-label="Overview"
        aria-pressed={open}
        className={buttonStyles}
        onClick={onToggle}
        type="button"
      >
        <AnimatedSquaresIcon size={15} />
      </button>
    }
  />
);

// Styled like the launcher button, and lit like a bar button whose panel is
// open.
const buttonStyles = css({
  _hover: { backgroundColor: "fillOverPhoto" },
  "&[aria-pressed=true]": { backgroundColor: "fillOverPhoto" },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "lg",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});
