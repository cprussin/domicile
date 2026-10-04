import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";

import { css } from "../../styled-system/css";

import type { Modifiers } from "../keyboard/useModifiers";
import type { StageScreen } from "../screens/stage-screens";
import { AppPopup } from "./AppPopup";
import { AppWindow } from "./AppWindow";
import { showsOneThing } from "./alone";
import { BrowserWindow } from "./BrowserWindow";
import type { Direction } from "./direction";
import { FloatBorder } from "./floating/FloatBorder";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatShadow } from "./floating/FloatShadow";
import { floatHolds } from "./floating/float";
import { floatBordersOf } from "./floating/float-borders";
import type { Geometry, Screenful } from "./placement";
import { contentsOf, TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import { Scrim } from "./Scrim";
import { TitleBar } from "./TitleBar";
import type { Aim, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import { focusedWindowIn } from "./tree/tiling";
import { useWindowMotion } from "./useWindowMotion";
import { WindowFrame } from "./WindowFrame";
import { WindowTitleBar } from "./WindowTitleBar";
import type { PopupWindowRequest, ShellWindow } from "./window";
import { WindowKind } from "./window";
import { barMotion } from "./window-motion";
import { slidAcross } from "./window-styles";

type Props = {
  /** The window the user is working in, which every bar is drawn against. */
  activeId: string | undefined;
  /**
   * Whether a panel of the desktop's own — the launcher, the clipboard — is up
   * over the windows, which is what takes the keyboard off them.
   */
  behindPanel: boolean;
  domicile: DomicileClient;
  /** The floating window the user has hold of, or `undefined` when none is. */
  draggingId: string | undefined;
  /**
   * The window the compositor is typing into, or `undefined` when the chrome
   * is. Not the same as `activeId`: see `AppWindow`.
   */
  focusedId: string | undefined;
  /** What the user is holding down, which decides who gets the pointer. */
  modifiers: Modifiers;
  onClose: (id: string) => void;
  onDrop: () => void;
  /**
   * A tiled window let go of over another: onto its `edge`, or its middle
   * where that is `undefined`.
   */
  onDropOn: (id: string, target: string, edge: Direction | undefined) => void;
  /** The screen, asked for from a window's own bar — `fullscreen`. */
  onFullscreen: (id: string) => void;
  onGrab: (id: string) => void;
  /**
   * The pointer moved into a window, which is the user working in it — with
   * the place it crossed at, because a window that arrives under a hand
   * nobody moved fires the same event.
   */
  onHover: (id: string, at: Spot) => void;
  onMove: (id: string, x: number, y: number) => void;
  /**
   * A browser window's page asked for a window of its own — a link with
   * `target="_blank"` followed.
   *
   * Not the window's own to open: a second browser window is one more window on
   * the workspace, which is the desktop's to place. Nothing names the window
   * that asked, because nothing about where the new one goes depends on it — it
   * opens where any window the user opens now would.
   */
  onOpenWindow: (url: string) => void;
  /**
   * An extension asked for a window of its own, through the browser window
   * the user was last in — see `BrowserWindow`. The desktop's to place, for
   * the reason a page's is.
   */
  onOpenPopupWindow: (request: PopupWindowRequest) => void;
  /** A browser window's page navigated, so its title says somewhere new. */
  onRename: (id: string, url: string) => void;
  /** A float resized to `box`, in the page's pixels, on the screen `on`. */
  onResize: (id: string, box: Rect, on: Geometry) => void;
  /** The user reached a window, by clicking into it or into its chrome. */
  onSelect: (id: string) => void;
  /**
   * A tiled window's `edge` dragged `by` pixels, rightwards or downwards, in
   * the tiling of the screen `on`.
   */
  onStretch: (id: string, edge: Direction, by: number, on: Geometry) => void;
  /** The popups clients have open, drawn over the windows here they belong to. */
  popups: readonly Popup[];
  /** Every screen of the desk, and what each one shows. */
  screens: readonly StageScreen[];
  windows: readonly ShellWindow[];
};

/**
 * Where the windows are: every one the workspaces on screen have a rectangle
 * for, each at the rectangle the layout gave it.
 *
 * **Once for the whole desk, not once a screen.** The page spans every
 * monitor, so a window is drawn at its place on the page whichever screen it
 * is on — and a float dragged onto the next screen is the element it was,
 * rather than another screen's copy of it: a `<webview>` made anew is a page
 * loaded again.
 *
 * **One list, in the order they were opened, however they are laid out.** Two
 * lists — tiled and floating, or one per workspace — would read better and
 * cost a window its contents: React reconciles by position, so a window moving
 * from one to the other unmounts and remounts, which is a portal re-created
 * blank and an embedded page reloaded to the URL it opened at. Where a window
 * is, is a rectangle; a window with no rectangle is hidden rather than
 * unmounted, for the same reason.
 *
 * **And the windows the desktop no longer has are in that same list**, at the
 * places they had, for as long as they are still leaving: one that has closed,
 * and every one of a workspace that has just been switched away from. Which
 * windows those are, and what each of them is doing, is `useWindowMotion`'s to
 * say — this draws the answer.
 */
export const Stage = ({
  activeId,
  behindPanel,
  domicile,
  draggingId,
  focusedId,
  modifiers: { meta, shift },
  onClose,
  onDrop,
  onDropOn,
  onFullscreen,
  onGrab,
  onHover,
  onMove,
  onOpenPopupWindow,
  onOpenWindow,
  onRename,
  onResize,
  onSelect,
  onStretch,
  popups,
  screens,
  windows,
}: Props) => {
  const motions = useWindowMotion(
    Object.fromEntries(
      screens.map(({ current, geometry, screenful: { placements, tabs } }) => [
        geometry.name,
        { activeId, current, placements, tabs, windows },
      ]),
    ),
  );
  // Every screen's floats at once: a window is on one screen at a time.
  const floats = screens.flatMap((screen) => screen.floats);
  // Whether the whole desk shows one thing, which leaves nothing sunk — see
  // `showsOneThing`.
  const alone = showsOneThing(screens.map(({ screenful }) => screenful));
  // Where a tiled window being moved would land, which is drawn over every
  // window rather than by the one being dragged — see `DropIndicator`.
  const [aim, setAim] = useState<Aim | undefined>(undefined);
  // Whether a tiled window's border is being dragged. Not a grab: the window
  // is resized in place rather than picked up, so it is not dimmed — see
  // `stageStyles` for the rest of what this changes.
  const [stretching, setStretching] = useState(false);
  const targets = screens.flatMap(({ screenful }) =>
    tiledTargets(screenful.placements),
  );
  return (
    <main className={stageStyles} data-stretching={stretching || undefined}>
      {/*
        Before every window, so each float covers its own shadow on document
        order — see `FloatShadow`. Not for a float filling the screen, whose
        shadow would fall off the edge of it and onto the next display.
      */}
      {motions.drawn.map(({ motion, placement, restack, screen, window }) =>
        placement !== undefined &&
        !fillsScreen(screens, window.id) &&
        floats.some((float) => floatHolds(float, window.id)) ? (
          <Sliding key={window.id} on={screenNamed(screens, screen)}>
            <FloatShadow
              depth={placement.depth}
              dragging={window.id === draggingId}
              frame={placement.frame}
              motion={motion}
              restack={restack}
            />
          </Sliding>
        ) : undefined,
      )}
      {motions.drawn.map(
        ({ focused, motion, placement, restack, screen, window }) => {
          const on = screenNamed(screens, screen);
          const floating = floats.find((float) => floatHolds(float, window.id));
          // While the desktop's modifier is held the pointer belongs to the shell
          // rather than to the client, so a drag can be caught in the page: over
          // every window there is a grab for — a floating one, and a tiled one on
          // screen. Not a fullscreen one, which has nowhere to be dragged to.
          //
          // While a drag runs it is every window, the tiled ones included. The
          // compositor hands the pointer to whichever window is under it, and the
          // windows a drag crosses are not the one being dragged: any of them that
          // still takes the pointer swallows the moves passing over it and the
          // release that should have ended the drag, leaving the window grabbed
          // with the mouse already let go.
          const clickThrough =
            draggingId !== undefined ||
            stretching ||
            (meta &&
              (floating !== undefined ||
                targets.some(({ id }) => id === window.id)));
          // A window with no contents on screen is not drawn, so what it would
          // stack against is not a question: it is rendered hidden, which is what
          // keeps its portal and its page alive across a workspace switch.
          const contents = contentsOf(placement);
          const depth = contents?.depth ?? 0;
          const onMotionEnded = () => {
            motions.onPlayedOut(window.id, motion, screen);
          };
          // A window's own bar is raised with the group `focus parent`
          // selected — unless it is a tab its container is hiding, which
          // raised would read as open beside the tab that is. Whether its
          // container shows it is a container's tab's question, below.
          const focus = titleFocus({
            hasKeyboard: focused,
            inSelection:
              placement?.selected === true && placement.surface !== undefined,
            shownByContainer: false,
          });
          return (
            <WindowFrame
              key={window.id}
              onHover={(at) => {
                onHover(window.id, at);
              }}
              onReach={() => {
                onSelect(window.id);
              }}
              width={on?.geometry.screen.width}
            >
              {window.kind === WindowKind.App ? (
                <AppWindow
                  appId={window.appId}
                  behindPanel={behindPanel}
                  clickThrough={clickThrough}
                  cursor={window.cursor}
                  depth={depth}
                  domicile={domicile}
                  dragging={window.id === draggingId}
                  focused={focused}
                  frame={placement?.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  hasKeyboard={window.id === focusedId}
                  motion={motion}
                  onMotionEnded={onMotionEnded}
                  rect={contents?.rect}
                  restack={restack}
                />
              ) : (
                <BrowserWindow
                  clickThrough={clickThrough}
                  covered={placement?.behind !== undefined}
                  depth={depth}
                  domicile={domicile}
                  dragging={window.id === draggingId}
                  focused={focused}
                  frame={placement?.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  motion={motion}
                  onClose={() => {
                    onClose(window.id);
                  }}
                  onMotionEnded={onMotionEnded}
                  onNavigate={(url) => {
                    onRename(window.id, url);
                  }}
                  onOpenPopupWindow={onOpenPopupWindow}
                  onOpenWindow={onOpenWindow}
                  onReach={() => {
                    onSelect(window.id);
                  }}
                  popupWindow={window.popupWindow}
                  rect={contents?.rect}
                  restack={restack}
                  src={window.src}
                />
              )}
              {/*
              After the contents, so the bar and the window it names tie on
              `z-index` and the bar wins on document order — while a window one
              place further up the stack still covers both. One bar for a tiled
              window and a floating one, so floating it keeps its bar rather
              than making a new one — see `WindowTitleBar`.
            */}
              {placement !== undefined && (
                <WindowTitleBar
                  besideOpenTab={placement.openTab !== undefined}
                  depth={placement.depth}
                  dragging={window.id === draggingId}
                  float={floating}
                  focus={focus}
                  frame={placement.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  motion={barMotion(motion)}
                  onAim={setAim}
                  onClose={() => {
                    onClose(window.id);
                  }}
                  onDrop={onDrop}
                  onDropOn={(target, edge) => {
                    onDropOn(window.id, target, edge);
                  }}
                  onFullscreen={() => {
                    onFullscreen(window.id);
                  }}
                  onGrab={() => {
                    onGrab(window.id);
                  }}
                  onMotionEnded={onMotionEnded}
                  onMove={(x, y) => {
                    onMove(window.id, x, y);
                  }}
                  rect={placement.bar}
                  restack={restack}
                  tabbed={placement.tabbed}
                  targets={targetsOn(on)}
                  title={window.title}
                  window={window.id}
                />
              )}
            </WindowFrame>
          );
        },
      )}
      {/*
        The tiled windows' borders, which resize them with no modifier held.
        After the windows and their bars, so a border wins the pointer over the
        edge of the window it overlaps; before the grabs, so a held modifier's
        grab covers everything but the gaps.
      */}
      {screens.flatMap((on) =>
        bordersOf(targetsOn(on)).map(({ edge, id, rect }) => (
          <TileBorder
            edge={edge}
            id={id}
            key={`${id}-${edge.toString()}`}
            onDrop={() => {
              setStretching(false);
            }}
            onGrab={() => {
              setStretching(true);
              onSelect(id);
            }}
            onStretch={(stretched, by) => {
              onStretch(id, stretched, by, on.geometry);
            }}
            rect={rect}
          />
        )),
      )}
      {/*
        And the floating windows' borders, the same way: at each one's own
        depth, so a window stacked over it covers its ring too. Not for a float
        filling the screen, which has no edge to drag. Once a float, by the
        window its own focus is on: a floating group is one box.
      */}
      {motions.drawn.map(({ placement, screen, window }) => {
        const on = screenNamed(screens, screen);
        const floating = on?.floats.find(
          (float) => focusedWindowIn(float.root) === window.id,
        );
        return placement === undefined ||
          on === undefined ||
          floating === undefined ||
          fillsScreen(screens, window.id)
          ? undefined
          : floatBordersOf(floating).map(({ cursor, grip, rect }) => (
              <FloatBorder
                cursor={cursor}
                depth={placement.depth}
                float={floating}
                grip={grip}
                key={`${window.id}-${grip.horizontal?.toString() ?? ""}-${grip.vertical?.toString() ?? ""}`}
                onDrop={() => {
                  setStretching(false);
                }}
                onGrab={() => {
                  setStretching(true);
                  onSelect(window.id);
                }}
                onResize={(box) => {
                  onResize(window.id, box, on.geometry);
                }}
                rect={rect}
                window={window.id}
              />
            ));
      })}
      {/*
        The grabs a held modifier puts over the windows, after every window and
        border so they cover both.

        In the windows' order rather than the stacking order, which moves every
        time a float is raised. Stacking is expressed as `z-index` — see
        `placedAt` — so nothing about what covers what needs these in stacking
        order, and putting them in it costs a drag: a browser releases pointer
        capture when the capturing element is moved in the document, and taking
        hold of a window raises it.
      */}
      {motions.drawn.map(({ placement, screen, window }) => {
        const on = screenNamed(screens, screen);
        const floating = on?.floats.find((float) =>
          floatHolds(float, window.id),
        );
        const onGrabThis = () => {
          onGrab(window.id);
        };
        if (placement === undefined || on === undefined) {
          return undefined;
        } else {
          const grabbable = targets.some(({ id }) => id === window.id);
          return (
            <Fragment key={window.id}>
              {floating === undefined &&
                grabbable &&
                (meta || window.id === draggingId) && (
                  <TileGrab
                    frame={placement.frame}
                    id={window.id}
                    onAim={setAim}
                    onDrop={onDrop}
                    onDropOn={(target, edge) => {
                      onDropOn(window.id, target, edge);
                    }}
                    onGrab={onGrabThis}
                    onStretch={(edge, by) => {
                      onStretch(window.id, edge, by, on.geometry);
                    }}
                    resizes={shift}
                    targets={targetsOn(on)}
                  />
                )}
              {/*
                Once a float, like its borders: a floating group is one box to
                take hold of, whichever of its windows the drag started over.
              */}
              {floating !== undefined &&
                focusedWindowIn(floating.root) === window.id &&
                (meta || window.id === draggingId) && (
                  <FloatGrab
                    depth={placement.depth}
                    float={floating}
                    onDrop={onDrop}
                    onGrab={onGrabThis}
                    onMove={(x, y) => {
                      onMove(window.id, x, y);
                    }}
                    onResize={(box) => {
                      onResize(window.id, box, on.geometry);
                    }}
                    resizes={shift}
                    window={window.id}
                  />
                )}
            </Fragment>
          );
        }
      })}
      {/*
        And the tabs of a tabbed or stacking container, which name a whole
        container rather than a window: the window they are titled after is the
        one that container last had the focus in, and picking one is reaching
        for that window.
      */}
      {motions.tabs.map(({ focused, motion, screen, tab }) => {
        const on = screenNamed(screens, screen);
        return (
          <Sliding key={tab.id} on={on}>
            <TitleBar
              besideOpenTab={tab.openTab !== undefined}
              // With the float it is in, if it is in one.
              depth={tab.depth}
              // Nothing drags a tab: it belongs to a container, which moves with
              // its float or not at all.
              dragging={false}
              // The tab of a container the keyboard is not in is still the open
              // one, and saying so with the accent would be a second window
              // claiming the keystrokes.
              focus={titleFocus({
                hasKeyboard: focused,
                inSelection: tab.selected && tab.active,
                shownByContainer: tab.active,
              })}
              // A tab is the whole of what the window behind it has on screen, so
              // it turns about its own middle.
              frame={tab.rect}
              // A workspace showing a fullscreen window draws no tabs at all — see
              // `placement.ts` — so this one never names it.
              fullscreen={fillsScreen(screens, tab.id)}
              motion={motion}
              onClose={() => {
                onClose(tab.id);
              }}
              onFullscreen={() => {
                onFullscreen(tab.id);
              }}
              onMiddleClick={() => {
                onClose(tab.id);
              }}
              onMotionEnded={() => {
                motions.onPlayedOut(tab.id, motion, screen);
              }}
              onPointerDown={() => {
                onSelect(tab.id);
              }}
              rect={tab.rect}
              title={titleOf(windows, tab.id)}
              window={tab.id}
            />
          </Sliding>
        );
      })}
      {/*
        And over all of it, a scrim over every window and tab, which sinks the
        ones the commands are not pointed at — after the windows and their bars,
        because two elements at one `z-index` are decided by the order they
        come in the document. Not over a window filling the screen, which
        covers every other.
      */}
      {motions.drawn.map(
        ({ focused, motion, placement, restack, screen, window }) =>
          placement === undefined ||
          fillsScreen(screens, window.id) ? undefined : (
            <Sliding key={window.id} on={screenNamed(screens, screen)}>
              <Scrim
                depth={placement.depth}
                dimmed={sinks(alone, focused, placement.selected)}
                dragging={window.id === draggingId}
                frame={placement.frame}
                // The bar's rather than the contents', which a tab switch fades
                // while the tab stays put.
                motion={barMotion(motion)}
                rect={placement.frame}
                restack={restack}
                tab={placement.surface === undefined}
                window={window.id}
              />
            </Sliding>
          ),
      )}
      {motions.tabs.map(({ focused, motion, screen, tab }) => (
        <Sliding key={tab.id} on={screenNamed(screens, screen)}>
          <Scrim
            depth={tab.depth}
            dimmed={sinks(alone, focused, tab.selected)}
            dragging={false}
            frame={tab.rect}
            motion={motion}
            rect={tab.rect}
            tab
            window={tab.id}
          />
        </Sliding>
      ))}
      {aim !== undefined && <DropIndicator rect={aim.rect} />}
      {/*
        Last, so a popup wins the tie with everything at its window's depth —
        the window, its bar and its scrim — and stays under a window stacked
        above its own, as a menu of a window behind does.
      */}
      {popupsOver(
        popups,
        screens.flatMap(({ screenful }) => screenful.placements),
      ).map((popup) => (
        <AppPopup key={popup.appId} popup={popup} />
      ))}
    </main>
  );
};

/**
 * While a border is dragged, every window follows it at once rather than
 * easing: the one being resized and the ones giving it room move together, so
 * an ease on any of them is a gap that opens and closes behind the pointer.
 * Over the whole stage because every window a stretch moves is one the drag
 * did not start on.
 */
const stageStyles = css({
  "&[data-stretching] *": { transition: "none" },
});

/**
 * The parts of the windows on the screen `on`, given its width: how far a
 * workspace switch slides them. Draws nothing — see `frameStyles` in
 * `WindowFrame` — and passes nothing on for a part on no screen.
 */
const Sliding = ({
  children,
  on,
}: {
  children: ReactNode;
  on: StageScreen | undefined;
}) => (
  <div
    className={slidingStyles}
    style={on === undefined ? undefined : slidAcross(on.geometry.screen.width)}
  >
    {children}
  </div>
);

const slidingStyles = css({ display: "contents" });

/**
 * Whether the window `id` fills its screen.
 *
 * Which its own bar has to know, because the bar of a fullscreen window is
 * drawn over it: the button that took the screen is the one that gives it
 * back, and it says so.
 */
const fillsScreen = (screens: readonly StageScreen[], id: string): boolean =>
  screens.some(({ fullscreenId }) => fullscreenId === id);

/** The screen named `name`, or `undefined` for a part drawn on none. */
const screenNamed = (
  screens: readonly StageScreen[],
  name: string | undefined,
): StageScreen | undefined =>
  screens.find(({ geometry }) => geometry.name === name);

/**
 * What a tiled window on the screen `on` can be dropped on: the tiled windows
 * of that screen, and none for a window on no screen.
 */
const targetsOn = (on: StageScreen | undefined): readonly Target[] =>
  on === undefined ? [] : tiledTargets(on.screenful.placements);

/**
 * The tiled windows on screen, which are what a tiled window can be picked up
 * from and dropped on: not one a tab is hiding, which has only its tab on
 * screen, and not one filling the screen, which has left the tiling's depth.
 */
const tiledTargets = (placements: Screenful["placements"]): readonly Target[] =>
  placements
    .filter(({ depth, surface }) => depth === TILED && surface !== undefined)
    .map(({ frame, id }) => ({ frame, id }));

/**
 * Whether a window or tab is sunk under its scrim: one the keyboard is not in
 * and `focus parent` has not selected the group of. Never while the desk shows
 * one thing alone, which has nothing to be picked out from.
 */
const sinks = (alone: boolean, focused: boolean, selected: boolean): boolean =>
  !alone && !focused && !selected;

/**
 * What a window is called.
 *
 * Throws for a window that is not open: a tab names the window its container
 * last had the focus in, and the layout a tab comes from is reduced together
 * with the list of windows — so a name with nothing behind it is a shell whose
 * two halves have come apart, rather than a window that has closed.
 */
const titleOf = (windows: readonly ShellWindow[], id: string): string => {
  const window = windows.find((found) => found.id === id);
  if (window === undefined) {
    throw new Error(`shell: no window ${id} to name`);
  } else {
    return window.title;
  }
};
