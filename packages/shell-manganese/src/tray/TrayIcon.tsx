import { Button } from "@domicile-desktop/component-library/Button";
import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import { watchMenu } from "@domicile-desktop/sdk/dbusmenu";
import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import { TrayMenu } from "./TrayMenu";
import { useTrayMenu } from "./useTrayMenu";

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

type Props = {
  /** Where clicks are sent. */
  domicile: DomicileHost;
  /** The icon, as the compositor last described it. */
  item: DomicileTrayItem;
  /** Injectable so tests can answer for the application's menu. */
  watch?: typeof watchMenu | undefined;
};

/**
 * An application's StatusNotifierItem in the bar's tray.
 *
 * Clicks go to the application: primary is `Activate`, middle
 * `SecondaryActivate`. Secondary opens the application's dbusmenu under the
 * icon, or sends `ContextMenu` for an application without one. The page's
 * context menu is suppressed so it does not cover the application's.
 *
 * An icon without an image shows the first letter of its title, so it can still
 * be clicked.
 */
export const TrayIcon = ({
  domicile,
  item: { bus, icon, id, menu, title },
  watch = watchMenu,
}: Props) => {
  // Where the open menu hangs from, or `undefined` while it is closed.
  const [at, setAt] = useState<Point | undefined>(undefined);
  const opened = useTrayMenu(domicile, bus, menu, at !== undefined, watch);
  return (
    <>
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
          if (menu === "") {
            domicile.activateTrayItem(id, "context");
          } else {
            const box = event.currentTarget.getBoundingClientRect();
            setAt({ x: box.left, y: box.bottom });
          }
        }}
        size="sm"
        variant="ghost"
      >
        {icon === "" ? (
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
      {at !== undefined && opened !== undefined && (
        <TrayMenu
          at={at}
          label={title}
          menu={opened.menu}
          onClick={opened.click}
          onClose={() => {
            setAt(undefined);
          }}
          onShow={opened.aboutToShow}
        />
      )}
    </>
  );
};

// Same size as extension icons, so both read as one row.
const imageStyles = css({ blockSize: 4, inlineSize: 4 });

// The same box as an image, so the row does not shift. Ten pixels, the bar's
// size, which has no font-size token.
const letterStyles = center({
  blockSize: 4,
  fontSize: "0.625rem",
  inlineSize: 4,
});
