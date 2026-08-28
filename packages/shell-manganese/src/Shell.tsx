import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import { defaultMeasure } from "@domicile/chrome-sdk/measure";
import { renderBands } from "@domicile/chrome-sdk/render-bands";
import { Button } from "@domicile/component-library/Button";
import { Card } from "@domicile/component-library/Card";
import {
  DisplayProvider,
  useDisplays,
} from "@domicile/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile/component-library/display-source";
import { Kbd } from "@domicile/component-library/Kbd";
import { Provider } from "@domicile/component-library/Provider";
import { Screen } from "@domicile/component-library/Screen";
import { TabRail } from "@domicile/component-library/TabRail";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";
import type { PropsWithChildren } from "react";
import { Fragment, useCallback, useEffect, useMemo } from "react";
import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { AppWindow } from "./AppWindow";
import type { AppElements } from "./app-elements";
import { BrowserWindow } from "./BrowserWindow";
import { bandDepths, showBand, showEveryBand } from "./bands";
import { Clock } from "./Clock";
import type { Chord } from "./chord";
import { claimedRegions } from "./claim-pointer";
import { FloatGrab } from "./FloatGrab";
import { FloatTitleBar } from "./FloatTitleBar";

import { floatingOf } from "./shell-state";
import { WindowKind } from "./shell-window";
import { useModifiers } from "./useModifiers";
import { useShellWindows } from "./useShellWindows";
import { useWindowSizedToDesktop } from "./useWindowSizedToDesktop";

/**
 * The band everything that is not a float's own chrome belongs to.
 *
 * Under every floating window, because a float's window is at `z-index: 1 +
 * its place in the stack` and this is at 0 — see `window-styles` and `bands`.
 */
const BAND_UNDER_EVERY_FLOAT = 0;

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

/** Alt+Tab, the same way. 15 is Tab. */
const ALT_TAB = { ...ALT_ENTER, key: 15 };

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

/** And Alt+Tab as the page names it. */
const ALT_TAB_CHORD: Chord = { ...ALT_ENTER_CHORD, key: "Tab" };

type ChromeProps = {
  appElements: AppElements;
  bridge: BridgeClient;
};

type DesktopProps = ChromeProps & {
  /**
   * How an element's placement is read, for the regions this chrome claims the
   * pointer in — see `claim-pointer`.
   *
   * Required here and defaulted where the tree is entered, so there is one
   * answer to what measuring means rather than one per component.
   */
  measure: Measure;
};

type Props = ChromeProps & {
  /**
   * How an element's placement is read — see {@link DesktopProps.measure}.
   *
   * Injected so a test can describe a layout: the test DOM has no cascade and
   * lays nothing out, so every real measurement there is a zero-sized box at
   * the origin. Defaults to the SDK's own, which is what puts a claim in the
   * same space as the windows it is tested against.
   */
  measure?: Measure;
  /**
   * Where the desktop comes from — the host over the bridge, or the window
   * itself where there is no host. Passed in rather than built here because the
   * entry point is what knows which of those this is, and because a source is
   * the connection: the provider re-registers whenever its identity changes and
   * `BridgeClient.on` is a single slot, so one built per render would
   * re-register per render.
   */
  displays: DisplaySource;
};

/**
 * The reference chrome over the desktop the host described.
 *
 * The page spans every display, so this is the composition root in the literal
 * sense as well: it holds the one {@link DisplayProvider} the whole tree reads
 * its screens from. `on` is a single slot, so there is exactly one listener for
 * the host's descriptions and every `<Screen>` below fans out from it.
 */
export const Shell = ({
  appElements,
  bridge,
  displays,
  measure = defaultMeasure,
}: Props) => (
  <Provider>
    <DisplayProvider source={displays}>
      <Desktop appElements={appElements} bridge={bridge} measure={measure} />
    </DisplayProvider>
  </Provider>
);

/**
 * The chrome itself: a rail of every open window beside a stage that shows one
 * of them, laid out over the screens.
 *
 * A window is either a Wayland client the host announced or a browser window
 * the shell opened itself; both get a tab, and the rail is what switches
 * between them. Everything the user touches here — the tabs, the launchers, the
 * theme toggle, a browser window's address bar — is a `@domicile/component-library`
 * component, so the chrome is styled entirely by the design system rather than
 * by a stylesheet of its own.
 *
 * One page, so one copy of this state across every display: moving a window
 * between screens is moving where its `<domicile-app>` is laid out, not handing
 * it to another shell.
 */
const Desktop = ({ appElements, bridge, measure }: DesktopProps) => {
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
  } = useShellWindows(bridge, appElements);

  // The depths this chrome draws at, so the compositor can put a window
  // between two of them. One band under every floating window and one per
  // float above it; see `bands`.
  //
  // Re-declared only when the count changes. Declaring the same depths again
  // is still a change as far as the compositor is concerned — what is *at* a
  // depth can move without the depth doing so — and it would start the round
  // trip over on every render.
  //
  // **Nothing at all while a window is being dragged.** A band costs a round
  // trip and the page answers one at a time, by leaving only that band
  // painting; a chrome that repaints every frame never holds still long enough
  // for the set to describe a single moment, so band 0 is a frame older than
  // band 1, which is a frame older than band 2, and the desktop composited out
  // of them is three moments at once. Declaring nothing puts the whole page
  // back and has it drawn flattened — what every chrome did before bands
  // existed. The cost is the one bands exist to remove, a bar landing over the
  // window in front, and it is worth paying for the length of a drag.
  const depths = useMemo(
    () => (draggingId === undefined ? bandDepths(floats.length) : []),
    [draggingId, floats.length],
  );

  useEffect(() => {
    const stop = renderBands(bridge, depths, showBand);
    return () => {
      stop();
      // The page is left showing whichever band was asked for last, because
      // nothing puts it back — so a chrome that stops declaring depths has to
      // put itself back, or the desktop keeps whatever band it was on and
      // loses the rest.
      showEveryBand();
    };
  }, [bridge, depths]);

  // Where the chrome takes the pointer over the windows, re-sent after every
  // commit rather than when some list changes: a bar moves for anything that
  // moves the window it names — a drag, a resize, a raise, a screen being
  // described — and every one of those is a render. No dependency array for
  // exactly that reason; the work is a measurement per floating window and the
  // set is sent whole, so a re-send that changed nothing costs nothing to
  // apply. See `claim-pointer`.
  useEffect(() => {
    bridge.claimPointer(claimedRegions(measure));
  });

  // Alt is what hands the pointer back to the page, and Shift is what makes
  // the drag a resize. Neither can be read off a DOM event here: while a
  // window holds the keyboard the page is told nothing, which is exactly when
  // the user is holding Alt over one. See `useModifiers`.
  const { alt, shift } = useModifiers(bridge);

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

  // Alt+Tab -> the window the user is working in leaves the rail, or goes back
  // into it. The window rather than the stage: once one is floating, the stage
  // is showing something else, and a toggle that acted on the stage could
  // never put a float back.
  const float = useCallback(() => {
    if (activeId !== undefined) {
      toggleFloat(activeId);
    }
  }, [activeId, toggleFloat]);

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
    bridge.grabShortcut(ALT_TAB);
    // `on` returns the bridge for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    bridge.on("shortcut", ({ shortcut }) => {
      if (shortcut.key === ALT_TAB.key) {
        float();
      } else {
        launch(shortcut.shift);
      }
    });
  }, [bridge, float, launch]);

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
      host.grab(ALT_TAB_CHORD);
      host.onPressed((chord) => {
        if (chord.key === ALT_TAB_CHORD.key) {
          float();
        } else {
          launch(chord.shift);
        }
      });
    }
  }, [float, launch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every modifier is part of the combination, the way the compositor's
      // claim and the host's are: Ctrl+Alt+Enter is a chord nobody claimed,
      // and the page is the only path that would otherwise answer it.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        // Taken from the page whether or not it does anything: the chord is
        // the desktop's for as long as it is held. A held key repeats tens of
        // times a second and only the first of them acts — the compositor
        // never sees a repeat at all, and the host takes them out of a guest's
        // stream, so one press does one thing on every path.
        switch (event.key) {
          case "Enter": {
            event.preventDefault();
            if (!event.repeat) {
              launch(event.shiftKey);
            }
            break;
          }
          case "Tab": {
            // And the browser's own focus ring, which Tab would otherwise
            // move out from under the window the user is floating.
            event.preventDefault();
            if (!event.repeat) {
              float();
            }
            break;
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [float, launch]);

  // The window this is drawn in is the main process's and the desktop is the
  // compositor's, so the size crosses back over the host IPC. Nothing happens
  // where there is no Electron host, or where Domicile composites this window
  // itself — see `useWindowSizedToDesktop`.
  useWindowSizedToDesktop();

  return (
    <>
      <OnTheFirstScreen>
        <div className={rootStyles}>
          {/*
            The rail is a band of its own element rather than of the row around
            it, because that row is also what the float chrome hangs inside and
            `opacity` multiplies: a bar inside a faded ancestor cannot fade
            back in. A flex child that hugs the rail, so the rail's own fixed
            width is still what decides the layout.
          */}
          <div className={railBandStyles} data-band={BAND_UNDER_EVERY_FLOAT}>
            <TabRail
              // The window the user is working in, which is not always the
              // one on the stage: a floating window is reached by its tab and
              // has to look reached.
              activeId={activeId ?? NO_WINDOW}
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
                id: window.id,
                label: window.title,
              }))}
            />
          </div>
          <main className={stageStyles}>
            {/*
              One list, floating and tabbed alike, in the order they were
              opened. Two lists would read better and cost a window its
              contents: React reconciles by position, so a window moving from
              one to the other unmounts and remounts — a portal re-created
              blank, and an embedded page reloaded to the URL it opened at.
              Floating is a matter of where a window is laid out, so that is
              all that changes here.
            */}
            {windows.map((window) => {
              const floating = floatingOf(floats, window.id);
              // On screen while it is floating whatever the stage is showing,
              // and while it is the one the stage shows.
              const onScreen = floating !== undefined || window.id === shownId;
              const dragging = window.id === draggingId;
              // While Alt is held the pointer belongs to the shell rather than
              // to the client, so the drag can be caught in the page — and it
              // goes on belonging to it for the rest of a drag that outlives
              // the key. Only a floating window: nothing drags one on the
              // stage, and taking the pointer off it would cost a click.
              //
              // **Every float while any drag runs, not just the one being
              // dragged.** The compositor hit-tests a rectangle and hands the
              // pointer to the window under it, and it is the *other* windows
              // a drag crosses: one that still takes the pointer swallows the
              // moves as the drag passes over it and the release that should
              // have ended it, which leaves the dragged window following a
              // pointer the page can no longer see. Alt covers this for as
              // long as it is held, and a drag routinely outlives it.
              const clickThrough =
                floating !== undefined && (alt || draggingId !== undefined);
              switch (window.kind) {
                case WindowKind.App: {
                  return (
                    <AppWindow
                      appElements={appElements}
                      appId={window.appId}
                      clickThrough={clickThrough}
                      dragging={dragging}
                      floating={floating}
                      focused={window.id === activeId}
                      key={window.id}
                      onScreen={onScreen}
                    />
                  );
                }
                case WindowKind.Browser: {
                  return (
                    <BrowserWindow
                      band={
                        floating === undefined
                          ? BAND_UNDER_EVERY_FLOAT
                          : floating.depth + 1
                      }
                      clickThrough={clickThrough}
                      dragging={dragging}
                      floating={floating}
                      focused={window.id === activeId}
                      key={window.id}
                      onNavigate={(url) => {
                        renameToSite(window.id, url);
                      }}
                      onScreen={onScreen}
                      src={window.src}
                    />
                  );
                }
              }
            })}
            {/*
              After every window, so that the chrome of a float and the window
              it belongs to tie on `z-index` and the chrome wins on document
              order — while a window one place further up the stack still
              covers both. Which is the case bands exist for: today the whole
              page is composited over every window, so the bar of a window
              behind another is drawn on top of the one in front.

              **In the windows' order rather than the floats'**, which is the
              stacking order and moves every time a window is raised. Stacking
              is expressed as `z-index` here — see `floatPlacement` — so
              nothing about what covers what needs these in stacking order,
              and putting them in it costs a drag: a browser releases pointer
              capture when the capturing element is moved in the document, and
              taking hold of a window raises it. The rest of that drag — every
              move, and the release that ends it — is then delivered to
              whatever the pointer is over instead, which is how a window
              could be left grabbed for ever with the pointer over another one.
            */}
            {windows.map((window) => {
              const floating = floatingOf(floats, window.id);
              const onMove = (x: number, y: number) => {
                move(window.id, x, y);
              };
              const onGrab = () => {
                grab(window.id);
              };
              return floating === undefined ? undefined : (
                <Fragment key={window.id}>
                  <FloatTitleBar
                    band={floating.depth + 1}
                    floating={floating}
                    focused={window.id === activeId}
                    onClose={() => {
                      close(window.id);
                    }}
                    onDrop={drop}
                    onGrab={onGrab}
                    onMove={onMove}
                    title={window.title}
                  />
                  {(alt || window.id === draggingId) && (
                    <FloatGrab
                      floating={floating}
                      onDrop={drop}
                      onGrab={onGrab}
                      onMove={onMove}
                      onResize={(width, height) => {
                        resize(window.id, width, height);
                      }}
                      resizes={shift}
                    />
                  )}
                </Fragment>
              );
            })}
            {windows.length === 0 && <EmptyStage />}
          </main>
        </div>
      </OnTheFirstScreen>
      <OnEveryOtherScreen>
        <div className={idleScreenStyles} data-band={BAND_UNDER_EVERY_FLOAT}>
          <Clock />
        </div>
      </OnEveryOtherScreen>
      <NoScreens />
    </>
  );
};

/**
 * The display the chrome goes on: the first one the config names.
 *
 * The shell cannot know what the user called their screens, so it cannot name
 * one — and a preference of its own would need somewhere to be written down
 * that the config already is. First is the answer that needs no configuration:
 * a desktop of one display has exactly one, and a desktop of several is in the
 * order the user wrote them.
 *
 * **Nothing until there is a desktop, rather than the whole page meanwhile.**
 * A chrome laid out over the page and then moved onto a screen is two different
 * elements in this slot, and React reconciles by position: the switch unmounts
 * the whole subtree and mounts a fresh one, taking every window with it — every
 * portal re-created blank, every embedded page reloaded to the URL its window
 * was opened at. Windows can already be on the stage by then, because a chrome
 * that reloads is told about the clients it missed and nothing makes the host
 * answer the handshake first. Waiting costs the handshake's worth of blank
 * window and mounts the chrome exactly once. Where nothing will ever describe a
 * desktop, `viewport-display` describes one rather than leaving this waiting.
 *
 * A desktop of no screens gets no chrome either, for the plainer reason that
 * there is nowhere to put it — but it is a different state from not having
 * been told, and {@link NoScreens} is what says so. `domicile-compositor`
 * never describes one: it holds at least one display before the chrome socket
 * is bound, and every description after that comes from `Screens`, which is a
 * non-empty configured `Desktop` or the single output following Domicile's own
 * window. The `domicile` daemon serves the same protocol from a bare `Session`
 * and describes nothing, so a chrome pointed at it gets exactly this.
 *
 * **A desktop that goes from having screens to having none takes the chrome
 * down with it**, which is the one case where waiting for a desktop does not
 * also mean mounting once. No host in this repo produces that transition —
 * the compositor's `Screens` is fixed at boot and never empty, and the daemon
 * only ever describes `[]` — so it costs nothing today, and the fix is not
 * free: `<Screen>` renders no region for a display that is not there, by
 * design, so keeping the chrome alive across an empty desktop means the shell
 * positioning its own region from the display's rectangle rather than nesting
 * inside one. Worth doing when a host can actually lose every screen, which is
 * hotplug — and worth doing then, because that is also when a desktop losing
 * one monitor of several stops being hypothetical.
 */
const OnTheFirstScreen = ({ children }: PropsWithChildren) => {
  const first = useDisplays()?.[0];
  return first === undefined ? undefined : (
    <Screen name={first.name}>{children}</Screen>
  );
};

/**
 * Every display the chrome is not on.
 *
 * There is one stage and it is on the first screen, so this is what the others
 * have to show. A clock, for now: it is what a second monitor is worth having
 * regardless, and it is the visible proof that a display the config describes
 * is laid out where it said — an empty region and a region that is not there
 * look identical.
 *
 * Nothing at all before the desktop is described, rather than everywhere: the
 * first screen is not known yet, so "the others" is not either.
 */
const OnEveryOtherScreen = ({ children }: PropsWithChildren) => {
  const first = useDisplays()?.[0];
  return first === undefined ? undefined : (
    <Screen match={(display) => display.name !== first.name}>{children}</Screen>
  );
};

/**
 * What the page says when the host describes a desktop with no screens.
 *
 * `undefined` and `[]` are different things, and this is what makes the
 * difference visible: not having been told yet is a moment, and a host that
 * says it has no screens is a host the chrome has nowhere to draw on. Without
 * this the two look identical from the outside — a blank window — which is the
 * failure the rest of this change exists to stop leaving behind.
 *
 * Rendered outside the `<Screen>` slot, and unconditionally: it is a sibling
 * of the chrome rather than an alternative to it, so nothing about the mount
 * that waits for a desktop is affected by it being here.
 *
 * Not fatal, unlike a refused handshake — a description is not a promise about
 * the next one, and a host that gains a screen describes the desktop again. It
 * is `domicile-config`'s job to say a configured desktop needs a display, and
 * this page's only to be honest about being told there is none.
 */
const NoScreens = () => {
  const displays = useDisplays();
  return displays?.length === 0 ? (
    <div className={noScreensStyles} data-band={BAND_UNDER_EVERY_FLOAT}>
      <Card title="No screens">
        <p className={hintStyles}>
          The host described a desktop with no displays on it, so there is
          nowhere to lay the chrome out. Domicile will draw it as soon as a
          screen is described.
        </p>
      </Card>
    </div>
  ) : undefined;
};

/** What the stage says before anything has been opened onto it. */
const EmptyStage = () => (
  <div className={emptyStageStyles} data-band={BAND_UNDER_EVERY_FLOAT}>
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

// A flex child that hugs the rail, so the rail's own fixed width is still what
// decides the layout; this is only here to be a band of its own.
const railBandStyles = flex({ shrink: 0 });

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

// The whole page, since there is no screen to put this on either.
const noScreensStyles = flex({
  align: "center",
  inset: 0,
  justify: "center",
  position: "absolute",
});

// A screen with no chrome on it. The clock sits in the middle of it, because
// there is nothing else there to sit beside.
const idleScreenStyles = flex({
  align: "center",
  blockSize: "100%",
  justify: "center",
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
