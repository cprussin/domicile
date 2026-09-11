import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { DomicileShortcut } from "@domicile/chrome-sdk/domicile-host";
import { Button } from "@domicile/component-library/Button";
import { Card } from "@domicile/component-library/Card";
import {
  DisplayProvider,
  useDisplays,
} from "@domicile/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile/component-library/display-source";
import { Provider } from "@domicile/component-library/Provider";
import { Screen } from "@domicile/component-library/Screen";
import { TabRail } from "@domicile/component-library/TabRail";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";
import type { PropsWithChildren } from "react";
import { Fragment, useCallback, useEffect } from "react";
import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import { Clock } from "./Clock";
import { FloatGrab } from "./FloatGrab";
import { FloatTitleBar } from "./FloatTitleBar";
import { floatingOf } from "./shell-state";
import { WindowKind } from "./shell-window";
import { useModifiers } from "./useModifiers";
import { useShellWindows } from "./useShellWindows";
import { Wallpaper } from "./Wallpaper";

/** A window with no tab selected — the rail's resting state on an empty shell. */
const NO_WINDOW = "";

/**
 * Alt+Enter, in the evdev keycodes the control channel speaks. 28 is Enter.
 *
 * Every modifier is named rather than left to the dictionary's default. The
 * compositor matches the set it was given and nothing else, so the three that
 * must *not* be held are as much of the chord as the one that must — and the
 * page's own `keydown` branch below has to agree with them or the same keys
 * would do two different things depending on which half heard them.
 */
const ALT_ENTER: DomicileShortcut = {
  altKey: true,
  ctrlKey: false,
  keycode: 28,
  metaKey: false,
  shiftKey: false,
};

/** Alt+Tab, the same way. 15 is Tab. */
const ALT_TAB: DomicileShortcut = { ...ALT_ENTER, keycode: 15 };

type ChromeProps = {
  domicile: DomicileClient;
};

type Props = ChromeProps & {
  /**
   * Where the desktop comes from — the host over the control channel, or the
   * window itself where there is no host. Passed in rather than built here because the
   * entry point is what knows which of those this is, and because a source is
   * the connection: the provider re-registers whenever its identity changes and
   * `DomicileClient.on` is a single slot, so one built per render would
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
export const Shell = ({ domicile, displays }: Props) => (
  <Provider>
    <DisplayProvider source={displays}>
      <Desktop domicile={domicile} />
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
const Desktop = ({ domicile }: ChromeProps) => {
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
  } = useShellWindows(domicile);

  // Alt is what hands the pointer back to the page, and Shift is what makes
  // the drag a resize. Neither can be read off a DOM event here: while a
  // window holds the keyboard the page is told nothing, which is exactly when
  // the user is holding Alt over one. See `useModifiers`.
  const { alt, ctrl, shift } = useModifiers(domicile);

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

  // Claimed from the desktop as well as listened for in the page. Where
  // Domicile draws this window, a key goes to whatever holds the keyboard —
  // so once a window is on screen the page hears nothing, which is exactly
  // when the user wants to open another one. A claimed combination is taken
  // out of the stream before the focused window is given it and arrives here
  // instead. Exactly one of the two paths fires per keystroke: either the
  // claim caught the key, or the page received it.
  useEffect(() => {
    domicile.grabShortcut(ALT_ENTER);
    domicile.grabShortcut({ ...ALT_ENTER, shiftKey: true });
    domicile.grabShortcut(ALT_TAB);
    // `on` returns the client for chaining, so it is deliberately not returned
    // as a cleanup — there is one handler per message type and re-registering
    // replaces it.
    // Flat rather than nested under a `shortcut` key: the press arrives as the
    // same dictionary that claimed it, so this compares the two field for
    // field without parsing anything.
    domicile.on("shortcut", ({ keycode, shiftKey }) => {
      if (keycode === ALT_TAB.keycode) {
        float();
      } else {
        launch(shiftKey);
      }
    });
  }, [domicile, float, launch]);

  // WHO ACTUALLY CATCHES THE CLAIM DEPENDS ON WHICH WINDOW HAS THE KEYBOARD,
  // and the claim above is one call because the shell should not have to care.
  // A Wayland client's keys never reach this process at all, so the compositor
  // matches those. A browser window's keys never leave it: a `<webview>` hosts
  // a page of its own and `view.focus()` hands the keyboard to it, so this
  // document is told nothing — which is why the browser process matches those,
  // in the guest's `PreHandleKeyboardEvent`, and sends the press back down the
  // same `shortcut` leg. This is where an Electron host needed a third claim
  // of its own; the fork needs none, because the layer that can see a guest's
  // keys is inside it.

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Every modifier is part of the combination, the way the compositor's
      // claim is: Ctrl+Alt+Enter is a combination nobody claimed, and the page
      // is the only path that would otherwise answer it.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        // Taken from the page whether or not it does anything: the
        // combination is the desktop's for as long as it is held. A held key
        // repeats tens of times a second and only the first of them acts — the
        // compositor never sees a repeat at all — so one press does one
        // thing on either path.
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

  // Nothing sizes the window this is drawn in, and nothing has to. It used to:
  // the page is the desktop, and a window narrower than the desktop leaves the
  // right-hand screens off the end of the viewport, where they still lay out
  // and still report positions the compositor honours — an invisible chrome
  // placing visible clients. Under Electron the window belonged to another
  // process and the ask crossed the host IPC. The engine's window is a Wayland
  // surface this compositor configures to the desktop's own size, which is
  // what `e2e-chrome-fills-the-desktop.sh` is about, so the page is handed the
  // right viewport rather than asking for one.

  return (
    <>
      {/*
        First, and outside every `<Screen>`: the viewport is the desktop, so one
        fixed sheet is the wallpaper of every screen on it, and a positioned
        sibling that comes first in the document is painted under all of them.
        It waits for no desktop either — there is no region for it to be moved
        into — so the handshake happens over a photograph.
      */}
      <Wallpaper />
      <OnTheFirstScreen>
        <div className={rootStyles}>
          {/*
            Its own element rather than the row around it, because that row is
            also what the float chrome hangs inside and `opacity` multiplies:
            a bar inside a faded ancestor cannot fade back in. A flex child
            that hugs the rail, so the rail's own fixed width is still what
            decides the layout.
          */}
          <div className={railWrapperStyles}>
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
              // to the client, so the drag can be caught in the page. Only a
              // floating window for that: nothing drags one on the stage, and
              // taking the pointer off it would cost a click.
              //
              // **While a drag runs, every window — the stage's included.**
              // The compositor hit-tests a rectangle and hands the pointer to
              // the window under it, and the windows a drag crosses are not
              // the one being dragged. Any of them that still takes the
              // pointer swallows the moves as the drag passes over it and the
              // release that should have ended it, and the window is left
              // grabbed with the mouse already let go. Dragging quickly is
              // what finds this: the pointer leaves the window it started on
              // and lands on whatever is beneath, which on this desktop is as
              // often the window on the stage as another float. Alt covers
              // the floats for as long as it is held; it covers the stage
              // never, and a drag routinely outlives the key besides.
              // Alt or Ctrl: either hands the pointer over, and Ctrl is what
              // makes a resize reachable without also holding Shift — the
              // secondary button does that part.
              const clickThrough =
                draggingId !== undefined ||
                (floating !== undefined && (alt || ctrl));
              switch (window.kind) {
                case WindowKind.App: {
                  return (
                    <AppWindow
                      appId={window.appId}
                      clickThrough={clickThrough}
                      cursor={window.cursor}
                      dragging={dragging}
                      floating={floating}
                      focused={window.id === activeId}
                      key={window.id}
                      onReach={() => {
                        select(window.id);
                      }}
                      onScreen={onScreen}
                      surfaceSize={window.surfaceSize}
                    />
                  );
                }
                case WindowKind.Browser: {
                  return (
                    <BrowserWindow
                      clickThrough={clickThrough}
                      domicile={domicile}
                      dragging={dragging}
                      floating={floating}
                      focused={window.id === activeId}
                      key={window.id}
                      onNavigate={(url) => {
                        renameToSite(window.id, url);
                      }}
                      onReach={() => {
                        select(window.id);
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
              covers both.

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
                  {(alt || ctrl || window.id === draggingId) && (
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
          </main>
        </div>
      </OnTheFirstScreen>
      <OnEveryOtherScreen>
        <div className={idleScreenStyles}>
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
    <div className={noScreensStyles}>
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

const rootStyles = flex({
  blockSize: "100%",
  direction: "row",
});

// A flex child that hugs the rail, so the rail's own fixed width is still what
// decides the layout.
const railWrapperStyles = flex({ shrink: 0 });

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

const hintStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
});
