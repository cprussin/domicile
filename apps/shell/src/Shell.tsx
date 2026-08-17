import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { Button } from "@domicile/component-library/Button";
import { Card } from "@domicile/component-library/Card";
import { Kbd } from "@domicile/component-library/Kbd";
import { Provider } from "@domicile/component-library/Provider";
import { TabRail } from "@domicile/component-library/TabRail";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";
import { useEffect } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { AppWindow } from "./AppWindow";
import type { AppElements } from "./app-elements";
import { BrowserWindow } from "./BrowserWindow";
import { Clock } from "./Clock";
import { WindowKind } from "./shell-window";
import { useShellWindows } from "./useShellWindows";

/** A window with no tab selected — the rail's resting state on an empty shell. */
const NO_WINDOW = "";

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
  useEffect(() => {
    const launch = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          openBrowser();
        } else {
          openTerminal();
        }
      }
    };
    document.addEventListener("keydown", launch);
    return () => {
      document.removeEventListener("keydown", launch);
    };
  }, [openBrowser, openTerminal]);

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
