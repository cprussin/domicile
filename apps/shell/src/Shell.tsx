import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { Button } from "@domicile/component-library/Button";
import { Card } from "@domicile/component-library/Card";
import { Kbd } from "@domicile/component-library/Kbd";
import { Provider } from "@domicile/component-library/Provider";
import { TabRail } from "@domicile/component-library/TabRail";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";
import { useCallback, useEffect } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { AppWindow } from "./AppWindow";
import type { AppElements } from "./app-elements";
import { BrowserWindow } from "./BrowserWindow";
import { Clock } from "./Clock";
import type { Chord } from "./chord";
import { WindowKind } from "./shell-window";
import { useShellWindows } from "./useShellWindows";

/** A window with no tab selected — the rail's resting state on an empty shell. */
const NO_WINDOW = "";

/** Alt+Enter, in the evdev keycodes the protocol speaks. 28 is Enter. */
const ALT_ENTER = {
  alt: true,
  ctrl: false,
  key: 28,
  logo: false,
  shift: false,
};

/**
 * The same combination as the page names its keys, which is what the Electron
 * host matches an embedded page's keys against — see `chord`.
 */
const ALT_ENTER_CHORD: Chord = {
  alt: true,
  ctrl: false,
  key: "Enter",
  meta: false,
  shift: false,
};

type Props = {
  appElements: AppElements;
  bridge: BridgeClient;
};

/**
 * The reference chrome: a rail of every open window beside a stage that shows
 * one of them.
 *
 * A window is either a Wayland client the host announced or a browser window
 * the shell opened itself; both get a tab, and the rail is what switches
 * between them. Everything the user touches here — the tabs, the launchers, the
 * theme toggle, a browser window's address bar — is a `@domicile/component-library`
 * component, so the chrome is styled entirely by the design system rather than
 * by a stylesheet of its own.
 */
export const Shell = ({ appElements, bridge }: Props) => {
  const {
    close,
    openBrowser,
    openTerminal,
    renameToSite,
    reorder,
    select,
    shownId,
    windows,
  } = useShellWindows(bridge, appElements);

  // Alt+Enter -> a terminal; add Shift for a browser.
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

  // Claimed from the compositor as well as listened for in the page. Where
  // Domicile draws this window, a key goes to whatever holds the keyboard —
  // so once a window is on screen the page hears nothing, which is exactly
  // when the user wants to open another one. A claimed combination is taken
  // out of the stream before the window is given it and arrives here instead.
  // The two never both fire: the compositor either intercepted the key or the
  // page received it.
  useEffect(() => {
    bridge.grabShortcut(ALT_ENTER);
    bridge.grabShortcut({ ...ALT_ENTER, shift: true });
    // `on` returns the bridge for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    bridge.on("shortcut", ({ shortcut }) => {
      launch(shortcut.shift);
    });
  }, [bridge, launch]);

  // And claimed from the Electron host, which covers the one keyboard neither
  // of those reaches: a `<webview>` is a browsing context of its own, so a key
  // pressed in a browser window on the stage goes to the site showing there
  // and nowhere else. Where Domicile composites this window the compositor
  // takes the key first and this never fires; where it does not, the host is
  // the only layer above the embedded page. There is no host at all when the
  // shell is opened in a plain browser for styling work.
  useEffect(() => {
    const host = window.domicileGuestShortcuts;
    if (host !== undefined) {
      host.grab(ALT_ENTER_CHORD);
      host.grab({ ...ALT_ENTER_CHORD, shift: true });
      host.onPressed((chord) => {
        launch(chord.shift);
      });
    }
  }, [launch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every modifier is part of the combination, the way the compositor's
      // claim and the host's are: Ctrl+Alt+Enter is a chord nobody claimed,
      // and the page is the only path that would otherwise answer it.
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key === "Enter"
      ) {
        // Taken from the page whether or not it opens anything: the chord is
        // the desktop's for as long as it is held. A held key repeats tens of
        // times a second and only the first of them opens a window — the
        // compositor never sees a repeat at all, and the host takes them out
        // of a guest's stream, so one press opens one window on every path.
        event.preventDefault();
        if (!event.repeat) {
          launch(event.shiftKey);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [launch]);

  return (
    <Provider>
      <div className={rootStyles}>
        <TabRail
          activeId={shownId ?? NO_WINDOW}
          brand={<span className={brandStyles}>Domicile</span>}
          footer={
            <div className={footerStyles}>
              <Button
                label="Terminal"
                onClick={openTerminal}
                size="sm"
                variant="ghost"
              >
                <TerminalWindowIcon size={18} />
              </Button>
              <ThemeSwitch />
              <Clock />
            </div>
          }
          onClose={close}
          onNew={openBrowser}
          onReorder={reorder}
          onSelect={select}
          tabs={windows.map((window) => ({
            // A client's window belongs to the client: the chrome can put it
            // off the stage but has no way to end it.
            closable: window.kind === WindowKind.Browser,
            id: window.id,
            label: window.title,
          }))}
        />
        <main className={stageStyles}>
          {windows.map((window) => {
            switch (window.kind) {
              case WindowKind.App: {
                return (
                  <AppWindow
                    active={window.id === shownId}
                    appElements={appElements}
                    appId={window.appId}
                    key={window.id}
                  />
                );
              }
              case WindowKind.Browser: {
                return (
                  <BrowserWindow
                    active={window.id === shownId}
                    key={window.id}
                    onNavigate={(url) => {
                      renameToSite(window.id, url);
                    }}
                    src={window.src}
                  />
                );
              }
            }
          })}
          {windows.length === 0 && <EmptyStage />}
        </main>
      </div>
    </Provider>
  );
};

/** What the stage says before anything has been opened onto it. */
const EmptyStage = () => (
  <div className={emptyStageStyles}>
    <Card title="No windows yet">
      <p className={hintStyles}>
        <Kbd>Alt</Kbd> + <Kbd>Enter</Kbd> opens a terminal on Domicile.
      </p>
      <p className={hintStyles}>
        <Kbd>Alt</Kbd> + <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> opens a browser
        window — so does <Kbd>+</Kbd> in the rail.
      </p>
    </Card>
  </div>
);

const rootStyles = flex({
  blockSize: "100%",
  direction: "row",
});

const brandStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  letterSpacing: "wide",
});

const footerStyles = hstack({
  gap: 2,
  justify: "space-between",
});

// The stage takes whatever the rail leaves, and every window in it fills the
// stage — the rail is what switches between them.
const stageStyles = css({
  flexGrow: 1,
  minInlineSize: 0,
  position: "relative",
});

const emptyStageStyles = flex({
  align: "center",
  inset: 0,
  justify: "center",
  position: "absolute",
});

const hintStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
});
