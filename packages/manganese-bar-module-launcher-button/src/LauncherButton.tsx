import { AnimatedSparkleIcon } from "@domicile-desktop/component-library/AnimatedSparkleIcon";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";

import { barButton } from "../styled-system/patterns";

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

const buttonStyles = barButton();
