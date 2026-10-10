import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ReactNode } from "react";
import { Fragment, memo, useCallback, useMemo, useState } from "react";

import { css } from "../../styled-system/css";

import type { Modifiers } from "../keyboard/useModifiers";
import type { StageScreen } from "../screens/stage-screens";
import { AppPopup } from "./AppPopup";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import type { Direction } from "./direction";
import { FocusGlow } from "./FocusGlow";
import { FloatBorder } from "./floating/FloatBorder";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatShadow } from "./floating/FloatShadow";
import type { Float } from "./floating/float";
import { floatHolds } from "./floating/float";
import { floatBordersOf } from "./floating/float-borders";
import { ScratchpadBackdrop } from "./floating/ScratchpadBackdrop";
import { GrabbingSheet } from "./GrabbingSheet";
import type {
  Geometry,
  PlacedFocusBox,
  PlacedTab,
  Placement,
  Screenful,
} from "./placement";
import { contentsOf, raised, TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { StripButtons } from "./StripButtons";
import { StripEnd } from "./StripEnd";
import { stripEndOf } from "./strip-end";
import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets, TabTarget, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import type { StripPlace } from "./tree/frames";
import { windowsIn } from "./tree/node";
import type { NodeRef } from "./tree/path";
import { focusedWindowIn } from "./tree/tiling";
import { keyOf, useFocusGlows } from "./useFocusGlows";
import type { DrawnWindow, WindowMotions } from "./useWindowMotion";
import { useWindowMotion } from "./useWindowMotion";
import { WindowFrame } from "./WindowFrame";
import { WindowTitleBar } from "./WindowTitleBar";
import type { ShellWindow } from "./window";
import { browserIdOf, WindowKind } from "./window";
import type { WindowMotion } from "./window-motion";
import { barMotion, isLeaving } from "./window-motion";
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
  /** Client windows' icon URLs, by desktop id. See `useClientIcons`. */
  clientIcons: ReadonlyMap<string, string>;
  /** Held modifiers, which decide who gets the pointer. */
  modifiers: Modifiers;
  onClose: (id: string) => void;
  /** A press on the backdrop under scratchpad window `id`. */
  onDismiss: (id: string) => void;
  onDrop: () => void;
  /** A tiled window dropped where it was aimed, on any screen. */
  onDropOn: (id: string, aim: Aim) => void;
  /** Toggles floating from a window's title bar. */
  onFloat: (id: string) => void;
  /** Toggles fullscreen from a window's title bar. */
  onFullscreen: (id: string) => void;
  onGrab: (id: string) => void;
  /** A tiled group dropped where it was aimed, on any screen. */
  onGroupDropOn: (group: NodeRef, aim: Aim) => void;
  /** Toggles floating from a tab group's strip. */
  onGroupFloat: (group: NodeRef) => void;
  /** Toggles fullscreen from a tab group's strip. */
  onGroupFullscreen: (group: NodeRef) => void;
  /** A tiled group taken hold of by the empty end of its tab strip. */
  onGroupGrab: (group: NodeRef) => void;
  /**
   * The pointer entered a window. `at` tells a real pointer move from a window
   * appearing under a still pointer.
   */
  onHover: (id: string, at: Spot) => void;
  /** A browser window's page icon. See `BrowserWindow`. */
  onIcon: (window: string, icon: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** The new-tab button past the last tab of the strip holding tab `id`. */
  onNewTab: (id: string) => void;
  /** Browser window `id`'s page entered or left fullscreen. */
  onPageFullscreen: (id: string, fullscreen: boolean) => void;
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
  /** The windows hidden in the scratchpad. */
  scratchpad: readonly string[];
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
export const Stage = memo(
  ({
    activeId,
    behindPanel,
    clientIcons,
    domicile,
    draggingId,
    focusedId,
    modifiers: { meta, shift },
    onClose,
    onDismiss,
    onDrop,
    onDropOn,
    onFloat,
    onFullscreen,
    onGrab,
    onGroupDropOn,
    onGroupFloat,
    onGroupFullscreen,
    onGroupGrab,
    onHover,
    onIcon,
    onMove,
    onNewTab,
    onPageFullscreen,
    onResize,
    onSelect,
    onStretch,
    popups,
    scratchpad,
    screens,
    windows,
  }: Props) => {
    const motions = useWindowMotion(
      Object.fromEntries(
        screens.map(
          ({ current, geometry, screenful: { placements, tabs } }) => [
            geometry.name,
            { activeId, current, placements, scratchpad, tabs, windows },
          ],
        ),
      ),
    );
    // Looked up once per change rather than once per window. Apart from the
    // windows, so a retitled window keeps the drop targets every bar takes.
    const desk = useMemo(() => deskOf(screens), [screens]);
    const named = useMemo(
      () => new Map(windows.map((window) => [window.id, window])),
      [windows],
    );
    const glows = useFocusGlows(focusBoxShowing(screens, activeId));
    const active = motions.drawn.find(({ window }) => window.id === activeId);
    // Drawn over every window, not by the dragged one: see `DropIndicator`.
    const [aim, setAim] = useState<Aim | undefined>(undefined);
    // A border drag or a tiled resize grab resizes in place, so unlike a move
    // it does not fade the window. See `stageStyles`.
    const [stretching, setStretching] = useState(false);
    // The window being moved, which fades. A tiled resize grab still sets
    // `draggingId`, which keeps its `TileGrab` mounted once the modifier is
    // let go.
    const movingId = stretching ? undefined : draggingId;
    const { onPlayedOut } = motions;
    const ends = stripEndsOf(motions);
    return (
      <main className={stageStyles} data-stretching={stretching || undefined}>
        {/*
          Before every window, so each float covers its own shadow by document
          order. See `FloatShadow`. Skipped for fullscreen floats, whose shadow
          would spill onto the next display.
        */}
        {motions.drawn.map(
          ({ motion, placement, restack, rewound, screen, window }) => {
            const float = desk.floats.get(window.id);
            return placement !== undefined &&
              !desk.fullscreen.has(window.id) &&
              float !== undefined ? (
              <Sliding
                frame={placement.frame}
                key={window.id}
                on={screenNamed(desk, screen)}
                rewound={rewound}
              >
                <FloatShadow
                  depth={placement.depth}
                  dragging={window.id === movingId}
                  frame={placement.frame}
                  hanging={float.scratchpad}
                  motion={motion}
                  restack={restack}
                />
              </Sliding>
            ) : undefined;
          },
        )}
        {/*
          Before every window too, so the windows at its depth cover all but
          its glow. Only the glow fading in follows the focused window's
          motion.
        */}
        {glows.map(({ box, leaving }) => {
          const following = leaving ? undefined : active;
          return (
            <Sliding
              frame={following?.placement?.frame}
              key={keyOf(box)}
              on={screenNamed(desk, following?.screen)}
              rewound={following?.rewound ?? 0}
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
          ({
            focused,
            motion,
            placement,
            restack,
            rewound,
            screen,
            window,
          }) => (
            <WindowContents
              behindPanel={behindPanel}
              // With the modifier held, the shell takes the pointer over every
              // grabbable window so it can catch a drag. During a drag it takes
              // it over every window: one that kept the pointer would swallow
              // the moves and the release, leaving the dragged window stuck.
              clickThrough={
                draggingId !== undefined ||
                stretching ||
                (meta &&
                  (desk.floats.has(window.id) || desk.targeted.has(window.id)))
              }
              domicile={domicile}
              dragging={stretching || window.id === movingId}
              focused={focused}
              fullscreen={desk.fullscreen.get(window.id) === false}
              hasKeyboard={window.id === focusedId}
              key={window.id}
              motion={motion}
              onHover={onHover}
              onIcon={onIcon}
              onPageFullscreen={onPageFullscreen}
              onPlayedOut={onPlayedOut}
              onSelect={onSelect}
              placement={placement}
              restack={restack}
              rewound={rewound}
              screen={screen}
              screenBox={screenNamed(desk, screen)?.geometry.screen}
              window={window}
            />
          ),
        )}
        {/*
          The empty ends of tabbed strips, which drag a whole group. Before the
          bars, so the new-tab button over an end wins the `z-index` tie.
        */}
        {ends.map(({ bar, depth, id, strip }) => {
          const floating = desk.floats.get(id);
          return (
            <StripEnd
              depth={depth}
              float={floating}
              fullscreen={groupFills(screens, strip.group.windows)}
              group={strip.group}
              // By group: a strip's last tab and its parent strip's last tab
              // can name one window.
              key={`${strip.group.node.id}-${strip.group.node.up.toString()}`}
              onAim={setAim}
              onDrop={onDrop}
              onDropOn={(aim) => {
                onGroupDropOn(strip.group.node, aim);
              }}
              onGrab={() => {
                if (floating === undefined) {
                  onGroupGrab(strip.group.node);
                } else {
                  onGrab(id);
                }
              }}
              onMove={(x, y) => {
                onMove(id, x, y);
              }}
              rect={endOf(bar, strip)}
              targets={desk.dropTargets}
            />
          );
        })}
        {/*
          Every bar after every window's contents, so bars win the `z-index`
          tie by document order. A shown tab's contents tuck under its whole
          strip (see `SURFACE_TUCK`), including other windows' tabs. One
          component for tiled and floating, so the bar is not remounted when
          the window floats. See `WindowTitleBar`.
        */}
        {motions.drawn.map(
          ({ focused, motion, placement, restack, rewound, screen, window }) =>
            placement === undefined ? undefined : (
              <WindowBar
                dragging={window.id === movingId}
                float={desk.floats.get(window.id)}
                focused={focused}
                fullscreen={desk.fullscreen.get(window.id) === false}
                icon={iconOf(window, clientIcons)}
                key={window.id}
                motion={motion}
                onAim={setAim}
                onClose={onClose}
                onDrop={onDrop}
                onDropOn={onDropOn}
                onFloat={onFloat}
                onFullscreen={onFullscreen}
                onGrab={onGrab}
                onHover={onHover}
                onMove={onMove}
                onNewTab={onNewTab}
                onPlayedOut={onPlayedOut}
                onSelect={onSelect}
                placement={placement}
                restack={restack}
                rewound={rewound}
                screen={screen}
                screenBox={screenNamed(desk, screen)?.geometry.screen}
                targets={desk.dropTargets}
                window={window}
              />
            ),
        )}
        {/*
          After every bar, so it covers the bars at its depth by document
          order.
        */}
        {screens.flatMap((on) => {
          const hanging = hangingOn(motions.drawn, on);
          return hanging?.placement === undefined
            ? []
            : [
                <ScratchpadBackdrop
                  depth={hanging.placement.depth - 1}
                  key={on.geometry.name}
                  motion={hanging.motion}
                  onDismiss={() => {
                    onDismiss(hanging.window.id);
                  }}
                  rewound={hanging.rewound}
                  screen={on.geometry.screen}
                />,
              ];
        })}
        {/*
          Tiled window borders, which resize without a modifier. After the
          windows, so a border wins the pointer over the edge it overlaps;
          before the grabs, so a modifier grab covers everything but the gaps.
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
          them. None for fullscreen floats, alone or in a group. One set per
          float, since a floating group is one box.
        */}
        {motions.drawn.map(({ placement, screen, window }) => {
          const on = screenNamed(desk, screen);
          const floating = desk.floatsFocusing.get(window.id);
          return placement === undefined ||
            on === undefined ||
            floating === undefined ||
            desk.fullscreen.has(window.id)
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
          const on = screenNamed(desk, screen);
          const floating = desk.floats.get(window.id);
          const onGrabThis = () => {
            onGrab(window.id);
          };
          if (placement === undefined || on === undefined) {
            return undefined;
          } else {
            return (
              <Fragment key={window.id}>
                {floating === undefined &&
                  desk.targeted.has(window.id) &&
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
                      targets={desk.dropTargets}
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
                      onDrop={() => {
                        setStretching(false);
                        onDrop();
                      }}
                      onGrab={(resizing) => {
                        setStretching(resizing);
                        onGrabThis();
                      }}
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
          const tabbed = windowNamed(named, tab.id);
          return (
            <ContainerTab
              floating={desk.floats.has(tab.id)}
              focused={focused}
              // Always false: a fullscreen workspace draws no tabs. See
              // `placement.ts`.
              fullscreen={desk.fullscreen.get(tab.id) === false}
              icon={iconOf(tabbed, clientIcons)}
              key={tab.id}
              motion={motion}
              on={screenNamed(desk, screen)}
              onClose={onClose}
              onFloat={onFloat}
              onFullscreen={onFullscreen}
              onNewTab={onNewTab}
              onPlayedOut={onPlayedOut}
              onSelect={onSelect}
              screen={screen}
              tab={tab}
              title={tabbed.title}
            />
          );
        })}
        {/*
          The group buttons at the ends of tabbed strips. After every bar and
          tab, so they win the `z-index` tie with the strip the last tab draws
          past itself.
        */}
        {ends.map(({ bar, depth, id, strip }) => (
          <GroupButtons
            bar={bar}
            depth={depth}
            floating={desk.floats.has(id)}
            fullscreen={groupFills(screens, strip.group.windows)}
            key={`${strip.group.node.id}-${strip.group.node.up.toString()}`}
            onFloat={onGroupFloat}
            onFullscreen={onGroupFullscreen}
            strip={strip}
          />
        ))}
        {aim !== undefined && <DropIndicator rect={aim.rect} />}
        {movingId !== undefined && <GrabbingSheet />}
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
  },
);

/**
 * The stage's lookups, built once per change to the screens rather than
 * searched once per window.
 */
type Desk = {
  /** What a tiled window can be dropped on, on every screen. */
  dropTargets: DropTargets;
  /** The float holding each floating window. */
  floats: ReadonlyMap<string, Float>;
  /** Each float by the window it focuses, which its borders hang on. */
  floatsFocusing: ReadonlyMap<string, Float>;
  /** Each fullscreen window, and whether it is fullscreen in a group. */
  fullscreen: ReadonlyMap<string, boolean>;
  screens: ReadonlyMap<string, StageScreen>;
  /** The visible tiled windows, which drag, drop and take the modifier grab. */
  targeted: ReadonlySet<string>;
};

const deskOf = (screens: readonly StageScreen[]): Desk => {
  // Reversed, so the first float holding a window wins, as `find` would.
  const floats = screens.flatMap((screen) => screen.floats).toReversed();
  const targets = screens.flatMap(({ screenful }) =>
    tiledTargets(screenful.placements),
  );
  return {
    dropTargets: {
      screens: emptyScreens(screens),
      tabs: tabTargets(screens),
      windows: targets,
    },
    floats: new Map(
      floats.flatMap((float) =>
        windowsIn(float.root).map((id) => [id, float] as const),
      ),
    ),
    floatsFocusing: new Map(
      floats.map((float) => [focusedWindowIn(float.root), float] as const),
    ),
    fullscreen: new Map(
      screens.flatMap(({ fullscreen }) =>
        fullscreen === undefined
          ? []
          : fullscreen.windows.map((id) => [id, fullscreen.group] as const),
      ),
    ),
    screens: new Map(screens.map((screen) => [screen.geometry.name, screen])),
    targeted: new Set(targets.map(({ id }) => id)),
  };
};

type WindowContentsProps = {
  behindPanel: boolean;
  clickThrough: boolean;
  domicile: DomicileHost;
  dragging: boolean;
  focused: boolean;
  fullscreen: boolean;
  hasKeyboard: boolean;
  motion: WindowMotion;
  onHover: (id: string, at: Spot) => void;
  onIcon: (window: string, icon: string) => void;
  onPageFullscreen: (id: string, fullscreen: boolean) => void;
  onPlayedOut: WindowMotions["onPlayedOut"];
  onSelect: (id: string) => void;
  placement: Placement | undefined;
  restack: Restack | undefined;
  /** How far into its motion it starts. See `DrawnWindow.rewound`. */
  rewound: number;
  screen: string | undefined;
  /** The box of the screen it is drawn on. */
  screenBox: Rect | undefined;
  window: ShellWindow;
};

/**
 * One window's contents. Memoized, with callbacks that take the window's id,
 * so a change to one window redraws only that window.
 */
const WindowContents = memo(
  ({
    behindPanel,
    clickThrough,
    domicile,
    dragging,
    focused,
    fullscreen,
    hasKeyboard,
    motion,
    onHover,
    onIcon,
    onPageFullscreen,
    onPlayedOut,
    onSelect,
    placement,
    restack,
    rewound,
    screen,
    screenBox,
    window,
  }: WindowContentsProps) => {
    const { id } = window;
    const contents = contentsOf(placement);
    const hovered = useCallback(
      (at: Spot) => {
        onHover(id, at);
      },
      [id, onHover],
    );
    const reached = useCallback(() => {
      onSelect(id);
    }, [id, onSelect]);
    const ended = useCallback(() => {
      onPlayedOut(id, motion, screen);
    }, [id, motion, onPlayedOut, screen]);
    const pageFilled = useCallback(
      (fullscreen: boolean) => {
        onPageFullscreen(id, fullscreen);
      },
      [id, onPageFullscreen],
    );
    return (
      <WindowFrame
        frame={placement?.frame}
        onHover={hovered}
        onReach={reached}
        rewound={rewound}
        screen={screenBox}
      >
        {window.kind === WindowKind.App ? (
          <AppWindow
            appId={window.appId}
            behindPanel={behindPanel}
            clickThrough={clickThrough}
            cursor={window.cursor}
            depth={contents?.depth ?? 0}
            domicile={domicile}
            dragging={dragging}
            focused={focused}
            frame={placement?.frame}
            fullscreen={fullscreen}
            hasKeyboard={hasKeyboard}
            motion={motion}
            onMotionEnded={ended}
            rect={contents?.rect}
            restack={restack}
          />
        ) : (
          <BrowserWindow
            behindPanel={behindPanel}
            clickThrough={clickThrough}
            covered={placement?.behind !== undefined}
            depth={contents?.depth ?? 0}
            domicile={domicile}
            dragging={dragging}
            focused={focused}
            frame={placement?.frame}
            fullscreen={fullscreen}
            isApp={window.isApp}
            isPrivate={window.isPrivate}
            motion={motion}
            onIcon={onIcon}
            onMotionEnded={ended}
            onPageFullscreen={pageFilled}
            onReach={reached}
            popupWindow={window.popupWindow}
            rect={contents?.rect}
            restack={restack}
            url={window.url}
            window={engineWindowOf(id)}
          />
        )}
      </WindowFrame>
    );
  },
);

type WindowBarProps = {
  dragging: boolean;
  float: Float | undefined;
  focused: boolean;
  fullscreen: boolean;
  icon: string | undefined;
  motion: WindowMotion;
  onAim: (aim: Aim | undefined) => void;
  onClose: (id: string) => void;
  onDrop: () => void;
  onDropOn: (id: string, aim: Aim) => void;
  onFloat: (id: string) => void;
  onFullscreen: (id: string) => void;
  onGrab: (id: string) => void;
  onHover: (id: string, at: Spot) => void;
  onMove: (id: string, x: number, y: number) => void;
  onNewTab: (id: string) => void;
  onPlayedOut: WindowMotions["onPlayedOut"];
  onSelect: (id: string) => void;
  placement: Placement;
  restack: Restack | undefined;
  /** How far into its motion it starts. See `DrawnWindow.rewound`. */
  rewound: number;
  screen: string | undefined;
  /** The box of the screen it is drawn on. */
  screenBox: Rect | undefined;
  targets: DropTargets;
  window: ShellWindow;
};

/** One window's title bar, memoized as {@link WindowContents} is. */
const WindowBar = memo(
  ({
    dragging,
    float,
    focused,
    fullscreen,
    icon,
    motion,
    onAim,
    onClose,
    onDrop,
    onDropOn,
    onFloat,
    onFullscreen,
    onGrab,
    onHover,
    onMove,
    onNewTab,
    onPlayedOut,
    onSelect,
    placement,
    restack,
    rewound,
    screen,
    screenBox,
    targets,
    window,
  }: WindowBarProps) => {
    const { id } = window;
    const hovered = useCallback(
      (at: Spot) => {
        onHover(id, at);
      },
      [id, onHover],
    );
    const reached = useCallback(() => {
      onSelect(id);
    }, [id, onSelect]);
    const ended = useCallback(() => {
      onPlayedOut(id, motion, screen);
    }, [id, motion, onPlayedOut, screen]);
    const closed = useCallback(() => {
      onClose(id);
    }, [id, onClose]);
    const droppedOn = useCallback(
      (aim: Aim) => {
        onDropOn(id, aim);
      },
      [id, onDropOn],
    );
    const floated = useCallback(() => {
      onFloat(id);
    }, [id, onFloat]);
    const filled = useCallback(() => {
      onFullscreen(id);
    }, [id, onFullscreen]);
    const grabbed = useCallback(() => {
      onGrab(id);
    }, [id, onGrab]);
    const moved = useCallback(
      (x: number, y: number) => {
        onMove(id, x, y);
      },
      [id, onMove],
    );
    const tabbed = useCallback(() => {
      onNewTab(id);
    }, [id, onNewTab]);
    return (
      <WindowFrame
        frame={placement.frame}
        onHover={hovered}
        onReach={reached}
        rewound={rewound}
        screen={screenBox}
      >
        <WindowTitleBar
          depth={placement.depth}
          dragging={dragging}
          float={float}
          // A hidden tab is not highlighted with its `focus parent` group, or
          // it would look open beside the shown tab. Container tabs are
          // handled in `ContainerTab`.
          focus={titleFocus({
            hasKeyboard: focused,
            inSelection: placement.selected && placement.surface !== undefined,
            isTab: placement.tabbed !== undefined,
            shownByContainer: false,
          })}
          frame={placement.frame}
          fullscreen={fullscreen}
          groupSelected={placement.selected}
          icon={icon}
          motion={barMotion(motion)}
          onAim={onAim}
          onClose={closed}
          onDrop={onDrop}
          onDropOn={droppedOn}
          onFloat={floated}
          onFullscreen={filled}
          onGrab={grabbed}
          onMotionEnded={ended}
          onMove={moved}
          onNewTab={tabbed}
          rect={placement.bar}
          restack={restack}
          strip={placement.strip}
          tabbed={placement.tabbed}
          targets={targets}
          title={window.title}
          window={id}
        />
      </WindowFrame>
    );
  },
);

type ContainerTabProps = {
  floating: boolean;
  focused: boolean;
  fullscreen: boolean;
  icon: string | undefined;
  motion: WindowMotion;
  on: StageScreen | undefined;
  onClose: (id: string) => void;
  onFloat: (id: string) => void;
  onFullscreen: (id: string) => void;
  onNewTab: (id: string) => void;
  onPlayedOut: WindowMotions["onPlayedOut"];
  onSelect: (id: string) => void;
  screen: string;
  tab: PlacedTab;
  /** The title of the window the tab is named after. */
  title: string;
};

/** A container's tab, memoized as {@link WindowContents} is. */
const ContainerTab = memo(
  ({
    floating,
    focused,
    fullscreen,
    icon,
    motion,
    on,
    onClose,
    onFloat,
    onFullscreen,
    onNewTab,
    onPlayedOut,
    onSelect,
    screen,
    tab,
    title,
  }: ContainerTabProps) => {
    const { id } = tab;
    const closed = useCallback(() => {
      onClose(id);
    }, [id, onClose]);
    const floated = useCallback(() => {
      onFloat(id);
    }, [id, onFloat]);
    const filled = useCallback(() => {
      onFullscreen(id);
    }, [id, onFullscreen]);
    const ended = useCallback(() => {
      onPlayedOut(id, motion, screen);
    }, [id, motion, onPlayedOut, screen]);
    const tabbed = useCallback(() => {
      onNewTab(id);
    }, [id, onNewTab]);
    const pressed = useCallback(() => {
      onSelect(id);
    }, [id, onSelect]);
    return (
      <Sliding frame={undefined} on={on} rewound={0}>
        <TitleBar
          depth={tab.depth}
          // A tab moves only with its container.
          dragging={false}
          floating={floating}
          // The shown tab of an unfocused container must not use the accent,
          // which marks keyboard focus.
          focus={titleFocus({
            hasKeyboard: focused,
            inSelection: tab.selected && tab.active,
            isTab: true,
            shownByContainer: tab.active,
          })}
          // A tab is all its window shows, so it scales about its own middle.
          frame={tab.rect}
          fullscreen={fullscreen}
          group={{ layout: tab.group, windows: tab.windows }}
          groupSelected={tab.selected}
          icon={icon}
          motion={motion}
          onClose={closed}
          onFloat={floated}
          onFullscreen={filled}
          onMiddleClick={closed}
          onMotionEnded={ended}
          onNewTab={tabbed}
          onPointerDown={pressed}
          rect={tab.rect}
          strip={tab.strip}
          tabbed={tab.tabbed}
          title={title}
          window={id}
        />
      </Sliding>
    );
  },
);

/**
 * Disables transitions during a resize drag, since easing would open gaps
 * between the resized window and its neighbors. Covers the whole stage because
 * the neighbors move too. Window contents ease with `useSettling` instead, so
 * every window is passed as `dragging`.
 */
const stageStyles = css({
  "&[data-stretching] *": { transition: "none" },
});

/**
 * Gives its children the distances that slide `frame` off screen `on`. Has no
 * box of its own; see `frameStyles` in `WindowFrame`.
 */
const Sliding = ({
  children,
  frame,
  on,
  rewound,
}: {
  children: ReactNode;
  frame: Rect | undefined;
  on: StageScreen | undefined;
  rewound: number;
}) => (
  <div
    className={slidingStyles}
    style={
      on === undefined
        ? undefined
        : slidAcross(on.geometry.screen, frame, rewound)
    }
  >
    {children}
  </div>
);

const slidingStyles = css({ display: "contents" });

/**
 * The scratchpad window shown on screen `on`, or one sliding off it back to the
 * scratchpad, if any.
 */
const hangingOn = (
  drawn: readonly DrawnWindow[],
  on: StageScreen,
): DrawnWindow | undefined =>
  drawn.find(
    ({ motion, screen, window }) =>
      screen === on.geometry.name &&
      (motion === "stowing" ||
        on.floats.some(
          (float) => float.scratchpad && floatHolds(float, window.id),
        )),
  );

/**
 * The tabbed strips drawn with an empty end, each with its last tab's bar,
 * window and depth, for the drag handle and buttons there.
 */
const stripEndsOf = (motions: WindowMotions) =>
  [
    ...motions.drawn.flatMap(({ motion, placement }) =>
      placement === undefined || isLeaving(motion) ? [] : [placement],
    ),
    ...motions.tabs.flatMap(({ motion, tab }) =>
      isLeaving(motion) ? [] : [{ ...tab, bar: tab.rect }],
    ),
  ].flatMap(({ bar, depth, id, strip }) =>
    strip === undefined || stripEndOf(bar, strip) === undefined
      ? []
      : [{ bar, depth: strip.open ? raised(depth) : depth, id, strip }],
  );

/** The empty end of a strip `stripEndsOf` found one on. */
const endOf = (bar: Rect, strip: StripPlace): Rect => {
  const end = stripEndOf(bar, strip);
  if (end === undefined) {
    throw new Error("stage: a strip end is missing");
  } else {
    return end;
  }
};

type GroupButtonsProps = {
  /** The bar of the strip's last tab. */
  bar: Rect;
  depth: number;
  floating: boolean;
  fullscreen: boolean;
  onFloat: (group: NodeRef) => void;
  onFullscreen: (group: NodeRef) => void;
  strip: StripPlace;
};

/**
 * A strip's group buttons, memoized as {@link WindowContents} is. Takes the
 * bar and strip, which keep their identity, rather than the end built from
 * them.
 */
const GroupButtons = memo(
  ({
    bar,
    depth,
    floating,
    fullscreen,
    onFloat,
    onFullscreen,
    strip,
  }: GroupButtonsProps) => {
    const { node } = strip.group;
    const floated = useCallback(() => {
      onFloat(node);
    }, [node, onFloat]);
    const filled = useCallback(() => {
      onFullscreen(node);
    }, [node, onFullscreen]);
    return (
      <StripButtons
        depth={depth}
        floating={floating}
        fullscreen={fullscreen}
        onFloat={floated}
        onFullscreen={filled}
        rect={endOf(bar, strip)}
      />
    );
  },
);

/** Whether the group of `windows` is fullscreen. */
const groupFills = (
  screens: readonly StageScreen[],
  windows: readonly string[],
): boolean =>
  screens.some(
    ({ fullscreen }) =>
      fullscreen?.group === true &&
      fullscreen.windows.join() === windows.join(),
  );

/** The screen named `name`, if any. */
const screenNamed = (
  desk: Desk,
  name: string | undefined,
): StageScreen | undefined =>
  name === undefined ? undefined : desk.screens.get(name);

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
 * The tiled windows' tabs, hidden ones too, which a tiled window can be
 * dropped beside. Excludes fullscreen screens, whose tiling is hidden.
 */
const tabTargets = (screens: readonly StageScreen[]): readonly TabTarget[] =>
  screens
    .filter(({ fullscreen }) => fullscreen === undefined)
    .flatMap(({ screenful }) => screenful.placements)
    .flatMap(({ bar, depth, id, strip, tabbed }) =>
      depth === TILED && strip !== undefined && tabbed !== undefined
        ? [{ at: strip.at, id, rect: bar, strip: strip.box, tabbed }]
        : [],
    );

/**
 * The screens with no tiled window to drop on, which a dropped window fills.
 * Excludes fullscreen ones, whose tiling is hidden.
 */
const emptyScreens = (
  screens: readonly StageScreen[],
): DropTargets["screens"] =>
  screens
    .filter(
      ({ fullscreen, screenful }) =>
        fullscreen === undefined &&
        tiledTargets(screenful.placements).length === 0,
    )
    .map(({ geometry }) => ({
      area: geometry.workspace,
      name: geometry.name,
    }));

/**
 * The focus box of whichever screen shows window `id`. It is around `id` unless
 * `id` is a scratchpad window; see `focusBoxIn`.
 */
const focusBoxShowing = (
  screens: readonly StageScreen[],
  id: string | undefined,
): PlacedFocusBox | undefined =>
  screens.find(({ screenful }) =>
    screenful.placements.some((placement) => placement.id === id),
  )?.screenful.focusBox;

/**
 * Window `id`, which a container's tab is named and marked after.
 *
 * Throws if the window is missing: the layout and window list update
 * together, so a missing window means inconsistent shell state.
 */
const windowNamed = (
  windows: ReadonlyMap<string, ShellWindow>,
  id: string,
): ShellWindow => {
  const window = windows.get(id);
  if (window === undefined) {
    throw new Error(`shell: no window ${id} to name`);
  } else {
    return window;
  }
};

/**
 * A window's icon URL: a client's from its desktop entry, a browser window's
 * page icon.
 */
const iconOf = (
  window: ShellWindow,
  clientIcons: ReadonlyMap<string, string>,
): string | undefined =>
  window.kind === WindowKind.App
    ? clientIcons.get(window.desktopId)
    : window.icon;

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
