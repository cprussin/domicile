import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
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
import { FocusGlow } from "./FocusGlow";
import { FloatBorder } from "./floating/FloatBorder";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatShadow } from "./floating/FloatShadow";
import { floatHolds } from "./floating/float";
import { floatBordersOf } from "./floating/float-borders";
import type { Geometry, PlacedFocusBox, Screenful } from "./placement";
import { contentsOf, TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import { focusedWindowIn } from "./tree/tiling";
import { keyOf, useFocusGlows } from "./useFocusGlows";
import { useWindowMotion } from "./useWindowMotion";
import { WindowFrame } from "./WindowFrame";
import { WindowTitleBar } from "./WindowTitleBar";
import type { ShellWindow } from "./window";
import { browserIdOf, WindowKind } from "./window";
import { barMotion } from "./window-motion";
import { slidAcross } from "./window-styles";

type Props = {
  /** The window the user is working in. */
  activeId: string | undefined;
  /**
   * Whether a desktop panel, such as the launcher, is open over the windows
   * and holds the keyboard.
   */
  behindPanel: boolean;
  domicile: DomicileHost;
  /** The floating window being dragged, if any. */
  draggingId: string | undefined;
  /**
   * The window with compositor keyboard focus, or `undefined` when the shell
   * has it. Can differ from `activeId`: see `AppWindow`.
   */
  focusedId: string | undefined;
  /** Held modifiers, which decide who gets the pointer. */
  modifiers: Modifiers;
  onClose: (id: string) => void;
  onDrop: () => void;
  /** A tiled window dropped where it was aimed, on any screen. */
  onDropOn: (id: string, aim: Aim) => void;
  /** Toggles floating from a window's title bar. */
  onFloat: (id: string) => void;
  /** Toggles fullscreen from a window's title bar. */
  onFullscreen: (id: string) => void;
  onGrab: (id: string) => void;
  /**
   * The pointer entered a window. `at` tells a real pointer move from a window
   * appearing under a still pointer.
   */
  onHover: (id: string, at: Spot) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** A float resized to `box`, in the page's pixels, on the screen `on`. */
  onResize: (id: string, box: Rect, on: Geometry) => void;
  /** The user clicked a window or its chrome. */
  onSelect: (id: string) => void;
  /**
   * A tiled window's `edge` dragged `by` pixels, rightwards or downwards, in
   * the tiling of the screen `on`.
   */
  onStretch: (id: string, edge: Direction, by: number, on: Geometry) => void;
  /** Client popups, drawn over their parent windows. */
  popups: readonly Popup[];
  /** Every screen and what it shows. */
  screens: readonly StageScreen[];
  /** Windows that asked for the keyboard. See `WindowState.urgent`. */
  urgent: readonly string[];
  windows: readonly ShellWindow[];
};

/**
 * Draws every window at the rectangle its layout gave it, across all screens.
 *
 * Renders one list for the whole desk, in opening order, so a window never
 * remounts when it moves between screens, workspaces or tiling and floating.
 * A remount would blank its portal and reload a `<webview>`. Windows without a
 * rectangle are hidden, not unmounted, for the same reason.
 *
 * Closing windows and windows of a workspace being switched away stay in the
 * list until their exit animation ends; `useWindowMotion` decides which.
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
  onFloat,
  onFullscreen,
  onGrab,
  onHover,
  onMove,
  onResize,
  onSelect,
  onStretch,
  popups,
  screens,
  urgent,
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
  const floats = screens.flatMap((screen) => screen.floats);
  const glows = useFocusGlows(
    showsOneThing(screens.map(({ screenful }) => screenful))
      ? undefined
      : focusBoxHolding(screens, activeId),
  );
  const active = motions.drawn.find(({ window }) => window.id === activeId);
  // Drawn over every window, not by the dragged one: see `DropIndicator`.
  const [aim, setAim] = useState<Aim | undefined>(undefined);
  // A border drag or a tiled resize grab resizes in place, so unlike a move it
  // does not fade the window. See `stageStyles`.
  const [stretching, setStretching] = useState(false);
  // The window being moved, which fades. A tiled resize grab still sets
  // `draggingId`, which keeps its `TileGrab` mounted once the modifier is let
  // go.
  const movingId = stretching ? undefined : draggingId;
  const targets = screens.flatMap(({ screenful }) =>
    tiledTargets(screenful.placements),
  );
  const dropTargets: DropTargets = {
    screens: emptyScreens(screens),
    windows: targets,
  };
  return (
    <main className={stageStyles} data-stretching={stretching || undefined}>
      {/*
        Before every window, so each float covers its own shadow by document
        order. See `FloatShadow`. Skipped for fullscreen floats, whose shadow
        would spill onto the next display.
      */}
      {motions.drawn.map(({ motion, placement, restack, screen, window }) =>
        placement !== undefined &&
        !fillsScreen(screens, window.id) &&
        floats.some((float) => floatHolds(float, window.id)) ? (
          <Sliding key={window.id} on={screenNamed(screens, screen)}>
            <FloatShadow
              depth={placement.depth}
              dragging={window.id === movingId}
              frame={placement.frame}
              motion={motion}
              restack={restack}
            />
          </Sliding>
        ) : undefined,
      )}
      {/*
        Before every window too, so the windows at its depth cover all but its
        glow. Only the glow fading in follows the focused window's motion.
      */}
      {glows.map(({ box, leaving }) => {
        const following = leaving ? undefined : active;
        return (
          <Sliding
            key={keyOf(box)}
            on={screenNamed(screens, following?.screen)}
          >
            <FocusGlow
              depth={box.depth}
              dragging={following !== undefined && activeId === movingId}
              leaving={leaving}
              motion={
                following === undefined
                  ? "resting"
                  : barMotion(following.motion)
              }
              rect={box.rect}
              restack={following?.restack}
              windows={box.windows}
            />
          </Sliding>
        );
      })}
      {motions.drawn.map(
        ({ focused, motion, placement, restack, screen, window }) => {
          const on = screenNamed(screens, screen);
          const floating = floats.find((float) => floatHolds(float, window.id));
          // With the modifier held, the shell takes the pointer over every
          // grabbable window so it can catch a drag. During a drag it takes it
          // over every window: one that kept the pointer would swallow the
          // moves and the release, leaving the dragged window stuck.
          const clickThrough =
            draggingId !== undefined ||
            stretching ||
            (meta &&
              (floating !== undefined ||
                targets.some(({ id }) => id === window.id)));
          const contents = contentsOf(placement);
          const depth = contents?.depth ?? 0;
          const onMotionEnded = () => {
            motions.onPlayedOut(window.id, motion, screen);
          };
          // A hidden tab is not highlighted with its `focus parent` group, or
          // it would look open beside the shown tab. Container tabs are
          // handled below.
          const focus = titleFocus({
            hasKeyboard: focused,
            inSelection:
              placement?.selected === true && placement.surface !== undefined,
            isTab: placement?.tabbed !== undefined,
            shownByContainer: false,
            urgent: urgent.includes(window.id),
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
                  dragging={window.id === movingId}
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
                  dragging={window.id === movingId}
                  focused={focused}
                  frame={placement?.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  isPrivate={window.isPrivate}
                  motion={motion}
                  onMotionEnded={onMotionEnded}
                  onReach={() => {
                    onSelect(window.id);
                  }}
                  popupWindow={window.popupWindow}
                  rect={contents?.rect}
                  restack={restack}
                  url={window.url}
                  window={engineWindowOf(window.id)}
                />
              )}
              {/*
              After the contents, so the bar wins the `z-index` tie by document
              order. One component for tiled and floating, so the bar is not
              remounted when the window floats. See `WindowTitleBar`.
            */}
              {placement !== undefined && (
                <WindowTitleBar
                  besideOpenTab={placement.openTab !== undefined}
                  depth={placement.depth}
                  dragging={window.id === movingId}
                  float={floating}
                  focus={focus}
                  frame={placement.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  groupSelected={placement.selected}
                  motion={barMotion(motion)}
                  onAim={setAim}
                  onClose={() => {
                    onClose(window.id);
                  }}
                  onDrop={onDrop}
                  onDropOn={(aim) => {
                    onDropOn(window.id, aim);
                  }}
                  onFloat={() => {
                    onFloat(window.id);
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
                  targets={dropTargets}
                  title={window.title}
                  window={window.id}
                />
              )}
            </WindowFrame>
          );
        },
      )}
      {/*
        Tiled window borders, which resize without a modifier. After the
        windows, so a border wins the pointer over the edge it overlaps; before
        the grabs, so a modifier grab covers everything but the gaps.
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
        Floating window borders, at each float's depth so windows above cover
        them. None for fullscreen floats. One set per float, since a floating
        group is one box.
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
        Modifier grabs, after every window and border so they cover both.

        In window order, not stacking order: stacking uses `z-index` (see
        `placedAt`), and reordering would move the capturing element when a
        grab raises its window, which makes the browser drop pointer capture.
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
                    onDrop={() => {
                      setStretching(false);
                      onDrop();
                    }}
                    onDropOn={(aim) => {
                      onDropOn(window.id, aim);
                    }}
                    onGrab={(resizing) => {
                      setStretching(resizing);
                      onGrabThis();
                    }}
                    onStretch={(edge, by) => {
                      onStretch(window.id, edge, by, on.geometry);
                    }}
                    resizes={shift}
                    targets={dropTargets}
                  />
                )}
              {/*
                One grab per float, like its borders.
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
        Tabs of tabbed and stacking containers. Each tab is titled after, and
        selects, the window its container last focused.
      */}
      {motions.tabs.map(({ focused, motion, screen, tab }) => {
        const on = screenNamed(screens, screen);
        return (
          <Sliding key={tab.id} on={on}>
            <TitleBar
              besideOpenTab={tab.openTab !== undefined}
              depth={tab.depth}
              // A tab moves only with its container.
              dragging={false}
              floating={floats.some((float) => floatHolds(float, tab.id))}
              // The shown tab of an unfocused container must not use the
              // accent, which marks keyboard focus.
              focus={titleFocus({
                hasKeyboard: focused,
                inSelection: tab.selected && tab.active,
                isTab: true,
                shownByContainer: tab.active,
                // The window the container last focused, which the tab names.
                urgent: urgent.includes(tab.id),
              })}
              // A tab is all its window shows, so it scales about its own
              // middle.
              frame={tab.rect}
              // Always false: a fullscreen workspace draws no tabs. See
              // `placement.ts`.
              fullscreen={fillsScreen(screens, tab.id)}
              group={{ layout: tab.group, windows: tab.windows }}
              groupSelected={tab.selected}
              motion={motion}
              onClose={() => {
                onClose(tab.id);
              }}
              onFloat={() => {
                onFloat(tab.id);
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
              tabbed={tab.tabbed}
              title={titleOf(windows, tab.id)}
              window={tab.id}
            />
          </Sliding>
        );
      })}
      {aim !== undefined && <DropIndicator rect={aim.rect} />}
      {/*
        Last, so a popup wins the `z-index` tie at its window's depth but
        stays under windows stacked above.
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
 * Disables transitions during a resize drag, since easing would open gaps
 * between the resized window and its neighbors. Covers the whole stage because
 * the neighbors move too.
 */
const stageStyles = css({
  "&[data-stretching] *": { transition: "none" },
});

/**
 * Gives its children the width of screen `on`, which a workspace switch
 * slides them by. Has no box of its own; see `frameStyles` in `WindowFrame`.
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

/** Whether the window `id` is fullscreen. */
const fillsScreen = (screens: readonly StageScreen[], id: string): boolean =>
  screens.some(({ fullscreenId }) => fullscreenId === id);

/** The screen named `name`, if any. */
const screenNamed = (
  screens: readonly StageScreen[],
  name: string | undefined,
): StageScreen | undefined =>
  screens.find(({ geometry }) => geometry.name === name);

/** The tiled windows on screen `on` that a tiled window can be dropped on. */
const targetsOn = (on: StageScreen | undefined): readonly Target[] =>
  on === undefined ? [] : tiledTargets(on.screenful.placements);

/**
 * The visible tiled windows, which can be dragged and dropped on. Excludes
 * hidden tabs and fullscreen windows.
 */
const tiledTargets = (placements: Screenful["placements"]): readonly Target[] =>
  placements
    .filter(({ depth, surface }) => depth === TILED && surface !== undefined)
    .map(({ frame, id }) => ({ frame, id }));

/**
 * The screens with no tiled window to drop on, which a dropped window fills.
 * Excludes fullscreen ones, whose tiling is hidden.
 */
const emptyScreens = (
  screens: readonly StageScreen[],
): DropTargets["screens"] =>
  screens
    .filter(
      ({ fullscreenId, screenful }) =>
        fullscreenId === undefined &&
        tiledTargets(screenful.placements).length === 0,
    )
    .map(({ geometry }) => ({
      area: geometry.workspace,
      name: geometry.name,
    }));

/** The focus box around window `id`, on whichever screen shows it. */
const focusBoxHolding = (
  screens: readonly StageScreen[],
  id: string | undefined,
): PlacedFocusBox | undefined =>
  id === undefined
    ? undefined
    : screens
        .map(({ screenful }) => screenful.focusBox)
        .find((box) => box?.windows.includes(id) === true);

/**
 * The title of window `id`.
 *
 * Throws if the window is missing: the layout and window list update
 * together, so a missing window means inconsistent shell state.
 */
const titleOf = (windows: readonly ShellWindow[], id: string): string => {
  const window = windows.find((found) => found.id === id);
  if (window === undefined) {
    throw new Error(`shell: no window ${id} to name`);
  } else {
    return window.title;
  }
};

/**
 * Returns the engine's id behind a browser window's window id. Every browser
 * window id is built from one, so a missing id is a wiring bug.
 */
const engineWindowOf = (id: string): string => {
  const engine = browserIdOf(id);
  if (engine === undefined) {
    throw new Error(`stage: ${id} is no browser window of the engine's`);
  } else {
    return engine;
  }
};
