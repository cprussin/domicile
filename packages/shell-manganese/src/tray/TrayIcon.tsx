import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { TrayItem } from "@domicile/chrome-sdk/tray";
import { Button } from "@domicile/component-library/Button";

import { css } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

type Props = {
  /** What every click asks. */
  domicile: DomicileClient;
  /** The icon, as the compositor last described it. */
  item: TrayItem;
};

/**
 * An application's StatusNotifierItem, on the bar's tray.
 *
 * **A click is the application's.** The primary button is `Activate` — its
 * window, usually — the middle one `SecondaryActivate`, and the secondary one
 * `ContextMenu`, which asks the application to open a menu of its own. The
 * page's own context menu is kept off the icon so that it does not open over
 * that one.
 *
 * An icon with no picture is labeled by the first letter of its title: an
 * application that sent nothing drawable is still one that can be clicked.
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
        // Not the engine's to drag: a press and a move reorders the tray.
        draggable={false}
        src={icon}
      />
    )}
  </Button>
);

// The extensions' size beside it, so the two kinds read as one row.
const imageStyles = css({ blockSize: 4, inlineSize: 4 });

// The same box as a picture, so an icon without one does not shift the row.
// Ten pixels, the bar's own size, which no font-size token is.
const letterStyles = center({
  blockSize: 4,
  fontSize: "0.625rem",
  inlineSize: 4,
});
