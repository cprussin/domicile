import { Button } from "@domicile-desktop/component-library/Button";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { TrayItem } from "@domicile-desktop/sdk/tray";

import { css } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

type Props = {
  /** Where clicks are sent. */
  domicile: DomicileClient;
  /** The icon, as the compositor last described it. */
  item: TrayItem;
};

/**
 * An application's StatusNotifierItem in the bar's tray.
 *
 * Clicks go to the application: primary is `Activate`, middle
 * `SecondaryActivate`, secondary `ContextMenu`. The page's context menu is
 * suppressed so it does not cover the application's.
 *
 * An icon without an image shows the first letter of its title, so it can still
 * be clicked.
 */
export const TrayIcon = ({ domicile, item: { icon, id, title } }: Props) => (
  <Button
    label={title}
    onAuxClick={(event) => {
      if (event.button === MIDDLE_BUTTON) {
        domicile.activateTrayItem(id, "secondary");
      }
    }}
    onClick={() => {
      domicile.activateTrayItem(id, "primary");
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      domicile.activateTrayItem(id, "context");
    }}
    size="sm"
    variant="ghost"
  >
    {icon === undefined ? (
      <span className={letterStyles}>{title.slice(0, 1)}</span>
    ) : (
      <img
        alt=""
        className={imageStyles}
        // Disable native drag; pointer drags reorder the tray.
        draggable={false}
        src={icon}
      />
    )}
  </Button>
);

// Same size as extension icons, so both read as one row.
const imageStyles = css({ blockSize: 4, inlineSize: 4 });

// The same box as an image, so the row does not shift. Ten pixels, the bar's
// size, which has no font-size token.
const letterStyles = center({
  blockSize: 4,
  fontSize: "0.625rem",
  inlineSize: 4,
});
