import { AnimatedSparkleIcon } from "@domicile-desktop/component-library/AnimatedSparkleIcon";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";

import { css } from "../styled-system/css";

type Props = {
  /** Opens the launcher from the button, for it to spring from. */
  onOpen: (from: Element) => void;
};

/** The bar's launcher button, the pointer equivalent of `mod+Space`. */
export const LauncherButton = ({ onOpen }: Props) => (
  <Tooltip
    content="Launcher"
    tone="overPhoto"
    trigger={
      <button
        aria-label="Launcher"
        className={buttonStyles}
        onClick={(event) => {
          onOpen(event.currentTarget);
        }}
        type="button"
      >
        <AnimatedSparkleIcon size={15} />
      </button>
    }
  />
);

// Styled like the bell button.
const buttonStyles = css({
  _hover: { backgroundColor: "fillOverPhoto" },
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
