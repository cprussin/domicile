import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useCallback } from "react";

import { flex } from "../styled-system/patterns";
import { useModifiers } from "./keyboard/useModifiers";
import { useShortcuts } from "./keyboard/useShortcuts";
import { FirstScreen } from "./screens/FirstScreen";
import { IdleScreen } from "./screens/IdleScreen";
import { NoScreens } from "./screens/NoScreens";
import { OtherScreens } from "./screens/OtherScreens";
import { Wallpaper } from "./wallpaper/Wallpaper";
import { Stage } from "./window-management/Stage";
import { useWindows } from "./window-management/useWindows";
import { WindowRail } from "./window-management/WindowRail";

type Props = {
  domicile: DomicileClient;
};

/**
 * The desktop: a rail of every open window beside a stage that shows one of
 * them, on the screen the config names first, and a clock on the rest.
 *
 * One page, so one copy of this state across every display: moving a window
 * between screens is moving where its `<app>` is laid out, not handing
 * it to another shell. The state lives here rather than in the chrome because
 * the chrome is not mounted until a desktop has been described, and the windows
 * the host announces before then are already the shell's.
 */
export const Desktop = ({ domicile }: Props) => {
  const {
    activeId,
    close,
    draggingId,
    drop,
    floats,
    grab,
    move,
    openBrowser,
    openTerminal,
    renameToSite,
    reorder,
    resize,
    select,
    shownId,
    toggleFloat,
    windows,
  } = useWindows(domicile);

  // Alt is what hands the pointer back to the page, and Shift is what makes a
  // drag a resize. Neither can be read off a DOM event here: while a window
  // holds the keyboard the page is told nothing, which is exactly when the user
  // is holding Alt over one.
  const modifiers = useModifiers(domicile);

  const launch = useCallback(
    (withShift: boolean) => {
      if (withShift) {
        openBrowser();
      } else {
        openTerminal();
      }
    },
    [openBrowser, openTerminal],
  );

  // The window rather than the stage: once one is floating, the stage is
  // showing something else, and a toggle that acted on the stage could never
  // put a float back.
  const float = useCallback(() => {
    if (activeId !== undefined) {
      toggleFloat(activeId);
    }
  }, [activeId, toggleFloat]);

  useShortcuts({ domicile, onFloat: float, onLaunch: launch });

  return (
    <>
      {/*
        First, and outside every screen: the viewport is the desktop, so one
        fixed sheet is the wallpaper of every screen on it, and a positioned
        sibling that comes first in the document is painted under all of them.
        It waits for no desktop either — there is no region for it to be moved
        into — so the handshake happens over a photograph.
      */}
      <Wallpaper />
      <FirstScreen>
        <div className={chromeStyles}>
          <WindowRail
            activeId={activeId}
            onClose={close}
            onNew={openBrowser}
            onOpenTerminal={openTerminal}
            onReorder={reorder}
            onSelect={select}
            windows={windows}
          />
          <Stage
            activeId={activeId}
            domicile={domicile}
            draggingId={draggingId}
            floats={floats}
            modifiers={modifiers}
            onClose={close}
            onDrop={drop}
            onGrab={grab}
            onMove={move}
            onRename={renameToSite}
            onResize={resize}
            onSelect={select}
            shownId={shownId}
            windows={windows}
          />
        </div>
      </FirstScreen>
      <OtherScreens>
        <IdleScreen />
      </OtherScreens>
      <NoScreens />
    </>
  );
};

const chromeStyles = flex({
  blockSize: "100%",
  direction: "row",
});
