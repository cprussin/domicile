import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import { useCallback, useEffect } from "react";

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
import { appIdOf } from "./window-management/window";

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
  // drag a resize. Both come off this page's own keyboard events, which is the
  // only place either can be read: the desktop is the chrome's window, so the
  // compositor's own answer is these keystrokes handed back short.
  const { modifiers, spendShift } = useModifiers();

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
  //
  // The Shift is spent whether or not there is a window to float, because what
  // it says is about the press rather than the outcome: the user pressed it to
  // reach this chord, and a Shift the desktop has already answered is not one
  // held over the window that lands. Both paths into here — the page's own
  // keydown and the chord the compositor hands back — go through it.
  const float = useCallback(() => {
    spendShift();
    if (activeId !== undefined) {
      toggleFloat(activeId);
    }
  }, [activeId, spendShift, toggleFloat]);

  useShortcuts({ domicile, onFloat: float, onLaunch: launch });

  // The window the user has hold of is the window they are working in, said
  // again because taking hold of one is what takes the keyboard off it: the
  // press lands on the shell's own chrome, and the SDK gives the keyboard back
  // to the page for any press that lands off every `<app>` — it cannot tell a
  // float's grab sheet from the wallpaper behind it, and nothing in the press
  // says which window that sheet belongs to. The shell knows, so the shell
  // says.
  //
  // From an effect rather than from the grab, because the SDK's handler is on
  // `document` and runs after the one the sheet carries: anything said during
  // the press is undone by the press. A browser window has no `focusApp` to
  // say it with — its page holds the focus itself — so only a client's window
  // is named here.
  const draggingAppId =
    draggingId === undefined ? undefined : appIdOf(draggingId);
  useEffect(() => {
    if (draggingAppId !== undefined) {
      focusApp(domicile, draggingAppId);
    }
  }, [domicile, draggingAppId]);

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
