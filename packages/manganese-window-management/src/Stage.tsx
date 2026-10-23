import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ReactNode } from "react";
import { Fragment, memo, useCallback, useMemo, useState } from "react";
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
import { castsFloatShadow, floatCovers } from "./floating/float-covers";
import { ScratchpadBackdrop } from "./floating/ScratchpadBackdrop";
import { GrabbingSheet } from "./GrabbingSheet";
import { GroupWell } from "./GroupWell";
import type { Modifiers } from "./keyboard/useModifiers";
import type {
  Geometry,
  PlacedFocusBox,
  PlacedTab,
  Placement,
  Screenful,
} from "./placement";
import { contentsOf, raised, TILED, wellDepthOf } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { SelectionTint } from "./SelectionTint";
import { SettleHandoffs } from "./SettleHandoffs";
import type { StageScreen } from "./screens/stage-screens";
import { useShared } from "./screens/useShared";
import { TabStrip } from "./TabStrip";
import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets, TabTarget, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import type { StripPlace } from "./tree/frames";
import { tabKeyOf } from "./tree/frames";
import { windowsIn } from "./tree/node";
import type { NodeRef } from "./tree/path";
import { focusedWindowIn } from "./tree/tiling";
import { useCaptured } from "./useCaptured";
import { keyOf, useFocusGlows } from "./useFocusGlows";
import type { DrawnWindow, WindowMotions } from "./useWindowMotion";
import { useWindowMotion } from "./useWindowMotion";
import { WindowFrame } from "./WindowFrame";
import { WindowTitleBar } from "./WindowTitleBar";
import type { ShellWindow } from "./window";
import { browserIdOf, WindowKind } from "./window";
import type { WindowMotion } from "./window-motion";
import { barMotion } from "./window-motion";
import { clippedTo, screenClipStyles, slidAcross } from "./window-styles";

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
  /** Closes every window in a group, from the tab that holds it. */
  onGroupClose: (group: NodeRef) => void;
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
  /**
   * Browser window `id`'s page or an extension asked for it in front. See
   * `BrowserWindow`.
   */
  onFocusRequest: (id: string) => void;
  /** A browser window's page description. See `BrowserWindow`. */
  onDescription: (window: string, description: string) => void;
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
    onDescription,
    onDismiss,
    onDrop,
    onDropOn,
    onFloat,
    onFocusRequest,
    onFullscreen,
    onGrab,
    onGroupClose,
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
    // Shared, so a change that moves no drop target keeps every bar's.
    const targets = useShared(desk.dropTargets);
    const named = useMemo(
      () => new Map(windows.map((window) => [window.id, window])),
      [windows],
    );
    const lit = focusBoxShowing(screens, activeId);
    const { glows, onFaded } = useFocusGlows(lit);
    const active = motions.drawn.find(({ window }) => window.id === activeId);
    const activeMotion =
      active === undefined ? "resting" : barMotion(active.motion);
    // Drawn over every window, not by the dragged one: see `DropIndicator`.
    const [aim, setAim] = useState<Aim | undefined>(undefined);
    // A border drag or a tiled resize grab resizes in place, so unlike a move
    // it does not fade the window. See `stageStyles`.
    const [stretching, setStretching] = useState(false);
    // The window being moved, which fades. A tiled resize grab still sets
    // `draggingId`, which keeps its `TileGrab` mounted once the modifier is
    // let go.
    const movingId = stretching ? undefined : draggingId;
    // Every window the drag carries, which follow the pointer without easing.
    const held = useMemo(() => heldBy(desk, movingId), [desk, movingId]);
    const { onPlayedOut } = motions;
    const tabsShown = motions.tabs.map(({ tab }) => tab);
    return (
      <main>
        <SettleHandoffs>
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
                  motion={motion}
                  on={screenNamed(desk, screen)}
                  rewound={rewound}
                >
                  <FloatShadow
                    depth={placement.depth}
                    dragging={stretching || held.has(window.id)}
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
          Before every window and glow, so the windows of each group shown in
          a tab, and their glows, lie on its well.
        */}
          {motions.tabs.map(({ motion, screen, tab }) =>
            tab.well === undefined ? undefined : (
              <Sliding
                frame={tab.well}
                key={`well-${tabKeyOf(tab)}`}
                motion={motion}
                on={screenNamed(desk, screen)}
                rewound={0}
              >
                <GroupWell
                  // None for fullscreen floats, as for `FloatShadow`.
                  castsShadow={
                    !desk.fullscreen.has(tab.id) &&
                    castsFloatShadow(desk.floats.get(tab.id), tab, tabsShown)
                  }
                  depth={wellDepthOf(tab.depth)}
                  dragging={stretching || held.has(tab.id)}
                  motion={motion}
                  nested={tab.strip.nested}
                  rect={tab.well}
                />
              </Sliding>
            ),
          )}
          {/*
          Before every window too, so the windows at its depth cover all but
          its glow. Only the glow fading in follows the focused window's
          motion.
        */}
          {glows.map(({ box, leaving }) => {
            const following = leaving ? undefined : active;
            const motion =
              following === undefined ? "resting" : barMotion(following.motion);
            return (
              <Sliding
                frame={following?.placement?.frame}
                key={keyOf(box)}
                motion={motion}
                on={screenNamed(desk, following?.screen)}
                rewound={following?.rewound ?? 0}
              >
                <FocusGlow
                  depth={box.depth}
                  dragging={
                    following !== undefined &&
                    (stretching ||
                      (activeId !== undefined && held.has(activeId)))
                  }
                  leaving={leaving}
                  motion={motion}
                  onFaded={() => {
                    onFaded(box);
                  }}
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
              screen,
              shownRewound,
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
                    (desk.floats.has(window.id) ||
                      desk.targeted.has(window.id)))
                }
                domicile={domicile}
                dragging={stretching || held.has(window.id)}
                floating={desk.floats.has(window.id)}
                focused={focused}
                fullscreen={desk.fullscreen.get(window.id) === false}
                hasKeyboard={window.id === focusedId}
                key={window.id}
                motion={motion}
                onDescription={onDescription}
                onFocusRequest={onFocusRequest}
                onHover={onHover}
                onIcon={onIcon}
                onPageFullscreen={onPageFullscreen}
                onPlayedOut={onPlayedOut}
                onSelect={onSelect}
                placement={placement}
                // Every window, since a tiled edge resizes the windows on
                // both sides of it. A window whose box stays put is unaffected.
                resizing={stretching}
                restack={restack}
                rewound={shownRewound}
                screen={screen}
                screenBox={screenNamed(desk, screen)?.geometry.screen}
                window={window}
              />
            ),
          )}
          {/*
          Tab strips, each drawn by its group's open tab, after every window's
          contents and before every bar, so the contents tuck under the strip
          and the tabs lie on it by document order. See `TabStrip`.
        */}
          {motions.drawn.map(
            ({ motion, placement, restack, screen, shownRewound, window }) =>
              placement?.strip?.open === true &&
              placement.tabbed !== undefined &&
              !leavesStrip(motion) ? (
                <GroupStrip
                  depth={placement.depth}
                  dragging={stretching || held.has(window.id)}
                  float={desk.floats.get(window.id)}
                  frame={placement.frame}
                  fullscreen={groupFills(
                    screens,
                    placement.strip.group.windows,
                  )}
                  id={window.id}
                  key={window.id}
                  motion={motion}
                  on={screenNamed(desk, screen)}
                  onAim={setAim}
                  onDrop={onDrop}
                  onGrab={onGrab}
                  onGroupDropOn={onGroupDropOn}
                  onGroupFloat={onGroupFloat}
                  onGroupFullscreen={onGroupFullscreen}
                  onGroupGrab={onGroupGrab}
                  onMove={onMove}
                  onNewTab={onNewTab}
                  restack={restack}
                  rewound={shownRewound}
                  strip={placement.strip}
                  targets={targets}
                />
              ) : undefined,
          )}
          {motions.tabs.map(({ motion, screen, tab }) =>
            tab.active && tab.strip.open ? (
              <GroupStrip
                depth={tab.depth}
                dragging={stretching || held.has(tab.id)}
                float={desk.floats.get(tab.id)}
                frame={tab.strip.box}
                fullscreen={groupFills(screens, tab.strip.group.windows)}
                id={tab.id}
                key={`tab-${tabKeyOf(tab)}`}
                motion={motion}
                on={screenNamed(desk, screen)}
                onAim={setAim}
                onDrop={onDrop}
                onGrab={onGrab}
                onGroupDropOn={onGroupDropOn}
                onGroupFloat={onGroupFloat}
                onGroupFullscreen={onGroupFullscreen}
                onGroupGrab={onGroupGrab}
                onMove={onMove}
                onNewTab={onNewTab}
                restack={undefined}
                rewound={0}
                strip={tab.strip}
                targets={targets}
              />
            ) : undefined,
          )}
          {/*
          Every bar after every window's contents, so bars win the `z-index`
          tie by document order. A shown tab's contents tuck under its whole
          strip (see `SURFACE_TUCK`), including other windows' tabs. One
          component for tiled and floating, so the bar is not remounted when
          the window floats. See `WindowTitleBar`. A bare float has none.
        */}
          {motions.drawn.map(
            ({
              focused,
              motion,
              placement,
              restack,
              rewound,
              screen,
              window,
            }) =>
              placement === undefined || placement.bare ? undefined : (
                <WindowBar
                  description={descriptionOf(window)}
                  dragging={stretching || held.has(window.id)}
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
                  onPlayedOut={onPlayedOut}
                  onSelect={onSelect}
                  placement={placement}
                  restack={restack}
                  rewound={rewound}
                  screen={screen}
                  screenBox={screenNamed(desk, screen)?.geometry.screen}
                  targets={targets}
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
                        targets={targets}
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
                description={descriptionOf(tabbed)}
                dragging={stretching || held.has(tab.id)}
                floating={desk.floats.has(tab.id)}
                focused={focused}
                // Always false: a fullscreen workspace draws no tabs. See
                // `placement.ts`.
                fullscreen={desk.fullscreen.get(tab.id) === false}
                icon={iconOf(tabbed, clientIcons)}
                key={tabKeyOf(tab)}
                motion={motion}
                on={screenNamed(desk, screen)}
                onClose={onGroupClose}
                onFloat={onFloat}
                onFullscreen={onFullscreen}
                onPlayedOut={onPlayedOut}
                onSelect={onSelect}
                screen={screen}
                tab={tab}
                title={tabbed.title}
              />
            );
          })}
          {/*
          After every window and tab, at the open tab's raised depth, so it
          covers the selected container's windows and every tab. It follows
          the focused window as its glow does.
        */}
          {lit?.selection !== undefined && (
            <Sliding
              frame={active?.placement?.frame}
              motion={activeMotion}
              on={screenNamed(desk, active?.screen)}
              rewound={active?.rewound ?? 0}
            >
              <SelectionTint
                depth={raised(lit.depth)}
                dragging={
                  stretching || (activeId !== undefined && held.has(activeId))
                }
                motion={activeMotion}
                rect={lit.selection}
                restack={active?.restack}
              />
            </Sliding>
          )}
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
        </SettleHandoffs>
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
      floats: floatCovers(screens),
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
  floating: boolean;
  focused: boolean;
  fullscreen: boolean;
  hasKeyboard: boolean;
  motion: WindowMotion;
  onDescription: (window: string, description: string) => void;
  onFocusRequest: (id: string) => void;
  onHover: (id: string, at: Spot) => void;
  onIcon: (window: string, icon: string) => void;
  onPageFullscreen: (id: string, fullscreen: boolean) => void;
  onPlayedOut: WindowMotions["onPlayedOut"];
  onSelect: (id: string) => void;
  placement: Placement | undefined;
  /** See `AppWindow`. */
  resizing: boolean;
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
    floating,
    focused,
    fullscreen,
    hasKeyboard,
    motion,
    onDescription,
    onFocusRequest,
    onHover,
    onIcon,
    onPageFullscreen,
    onPlayedOut,
    onSelect,
    placement,
    resizing,
    restack,
    rewound,
    screen,
    screenBox,
    window,
  }: WindowContentsProps) => {
    const { id } = window;
    const captured = useCaptured(
      domicile,
      window.kind === WindowKind.App ? undefined : engineWindowOf(id),
    );
    const contents = contentsOf(placement, motion, captured);
    const hovered = useCallback(
      (at: Spot) => {
        onHover(id, at);
      },
      [id, onHover],
    );
    const reached = useCallback(() => {
      onSelect(id);
    }, [id, onSelect]);
    const asked = useCallback(() => {
      onFocusRequest(id);
    }, [id, onFocusRequest]);
    const ended = useCallback(() => {
      onPlayedOut(id, motion, screen, "contents");
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
        motion={motion}
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
            floating={floating}
            focused={focused}
            frame={placement?.frame}
            fullscreen={fullscreen}
            hasKeyboard={hasKeyboard}
            motion={motion}
            onMotionEnded={ended}
            rect={contents?.rect}
            resizing={resizing}
            restack={restack}
            syncedFrame={window.syncedFrame}
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
            onDescription={onDescription}
            onFocusRequest={asked}
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
  description: string | undefined;
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
    description,
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
      onPlayedOut(id, motion, screen, "bar");
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
    return (
      <WindowFrame
        frame={placement.frame}
        motion={motion}
        onHover={hovered}
        onReach={reached}
        rewound={rewound}
        screen={screenBox}
      >
        <WindowTitleBar
          depth={placement.depth}
          description={description}
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
  /** The page description of the window the tab is named after. */
  description: string | undefined;
  dragging: boolean;
  floating: boolean;
  focused: boolean;
  fullscreen: boolean;
  icon: string | undefined;
  motion: WindowMotion;
  on: StageScreen | undefined;
  /** Closes the tab's group, every window in it. */
  onClose: (group: NodeRef) => void;
  onFloat: (id: string) => void;
  onFullscreen: (id: string) => void;
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
    description,
    dragging,
    floating,
    focused,
    fullscreen,
    icon,
    motion,
    on,
    onClose,
    onFloat,
    onFullscreen,
    onPlayedOut,
    onSelect,
    screen,
    tab,
    title,
  }: ContainerTabProps) => {
    const { id, node } = tab;
    const closed = useCallback(() => {
      onClose(node);
    }, [node, onClose]);
    const floated = useCallback(() => {
      onFloat(id);
    }, [id, onFloat]);
    const filled = useCallback(() => {
      onFullscreen(id);
    }, [id, onFullscreen]);
    const ended = useCallback(() => {
      onPlayedOut(id, motion, screen, "bar");
    }, [id, motion, onPlayedOut, screen]);
    const pressed = useCallback(() => {
      onSelect(id);
    }, [id, onSelect]);
    return (
      <Sliding frame={undefined} motion={motion} on={on} rewound={0}>
        <TitleBar
          depth={tab.depth}
          description={description}
          dragging={dragging}
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
          icon={icon}
          motion={motion}
          onClose={closed}
          onFloat={floated}
          onFullscreen={filled}
          onMiddleClick={closed}
          onMotionEnded={ended}
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
 * Gives its children the distances that slide `frame` off screen `on`, and
 * clips them to it during a workspace switch. See `screenClipStyles`.
 */
const Sliding = ({
  children,
  frame,
  motion,
  on,
  rewound,
}: {
  children: ReactNode;
  frame: Rect | undefined;
  motion: WindowMotion;
  on: StageScreen | undefined;
  rewound: number;
}) => (
  <div
    className={screenClipStyles}
    style={
      on === undefined
        ? undefined
        : {
            ...slidAcross(on.geometry.screen, frame, rewound),
            ...clippedTo(on.geometry.screen, motion),
          }
    }
  >
    {children}
  </div>
);

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

type GroupStripProps = {
  depth: number;
  dragging: boolean;
  float: Float | undefined;
  /** The open window's whole box. See `TabStrip`. */
  frame: Rect;
  fullscreen: boolean;
  /** The open tab's window, which draws the strip. */
  id: string;
  motion: WindowMotion;
  on: StageScreen | undefined;
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onGrab: (id: string) => void;
  onGroupDropOn: (group: NodeRef, aim: Aim) => void;
  onGroupFloat: (group: NodeRef) => void;
  onGroupFullscreen: (group: NodeRef) => void;
  onGroupGrab: (group: NodeRef) => void;
  onMove: (id: string, x: number, y: number) => void;
  onNewTab: (id: string) => void;
  restack: Restack | undefined;
  rewound: number;
  strip: StripPlace;
  targets: DropTargets;
};

/**
 * A group's tab strip, drawn by its open tab, memoized as
 * {@link WindowContents} is.
 */
const GroupStrip = memo(
  ({
    depth,
    dragging,
    float,
    frame,
    fullscreen,
    id,
    motion,
    on,
    onAim,
    onDrop,
    onGrab,
    onGroupDropOn,
    onGroupFloat,
    onGroupFullscreen,
    onGroupGrab,
    onMove,
    onNewTab,
    restack,
    rewound,
    strip,
    targets,
  }: GroupStripProps) => {
    const { node } = strip.group;
    const floating = float !== undefined;
    const droppedOn = useCallback(
      (aim: Aim) => {
        onGroupDropOn(node, aim);
      },
      [node, onGroupDropOn],
    );
    const floated = useCallback(() => {
      onGroupFloat(node);
    }, [node, onGroupFloat]);
    const filled = useCallback(() => {
      onGroupFullscreen(node);
    }, [node, onGroupFullscreen]);
    // A float moves as one box, by any of its windows.
    const grabbed = useCallback(() => {
      if (floating) {
        onGrab(id);
      } else {
        onGroupGrab(node);
      }
    }, [floating, id, node, onGrab, onGroupGrab]);
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
      <Sliding frame={frame} motion={motion} on={on} rewound={rewound}>
        <TabStrip
          box={strip.box}
          depth={depth}
          dragging={dragging}
          end={strip.end}
          endDivided={strip.endDivided}
          float={float}
          frame={frame}
          fullscreen={fullscreen}
          group={strip.group}
          motion={motion}
          nested={strip.nested}
          onAim={onAim}
          onDrop={onDrop}
          onDropOn={droppedOn}
          onFloat={floated}
          onFullscreen={filled}
          onGrab={grabbed}
          onMove={moved}
          onNewTab={tabbed}
          restack={restack}
          targets={targets}
        />
      </Sliding>
    );
  },
);

/**
 * Whether a window playing `motion` leaves its strip while the strip stays:
 * a tab closing or sent away, not its whole group.
 */
const leavesStrip = (motion: WindowMotion): boolean =>
  motion === "closing-tab" || motion === "sending-tab";

/**
 * The windows a drag of `id` carries with the pointer: a float's every window.
 * A dragged tiled window stays in its slot until it moves, so it eases there.
 */
const heldBy = (desk: Desk, id: string | undefined): ReadonlySet<string> => {
  const float = id === undefined ? undefined : desk.floats.get(id);
  return new Set(float === undefined ? [] : windowsIn(float.root));
};

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
 * Every window's tab, tiled or floating, hidden ones too, which a window can
 * be dropped beside. Excludes fullscreen screens, whose windows are hidden.
 */
const tabTargets = (screens: readonly StageScreen[]): readonly TabTarget[] =>
  shownPlacements(screens).flatMap(({ bar, depth, id, strip, tabbed }) =>
    strip !== undefined && tabbed !== undefined
      ? [{ at: strip.at, depth, id, rect: bar, strip: strip.box, tabbed }]
      : [],
  );

/** The placements of screens with nothing fullscreen. */
const shownPlacements = (
  screens: readonly StageScreen[],
): readonly Placement[] =>
  screens
    .filter(({ fullscreen }) => fullscreen === undefined)
    .flatMap(({ screenful }) => screenful.placements);

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

/** A browser window's page description; a client's window has none. */
const descriptionOf = (window: ShellWindow): string | undefined =>
  window.kind === WindowKind.App ? undefined : window.description;

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
