import { AnimatedSquaresIcon } from "@domicile-desktop/component-library/AnimatedSquaresIcon";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";

import { barButton } from "../styled-system/patterns";

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

// Lit like a bar button whose panel is open while the overview is.
const buttonStyles = barButton({
  "&[aria-pressed=true]": { backgroundColor: "fillOverPhoto" },
});
