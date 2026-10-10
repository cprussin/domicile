import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";

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
import { floatHolds } from "./floating/float";
import { floatBordersOf } from "./floating/float-borders";
import { ScratchpadBackdrop } from "./floating/ScratchpadBackdrop";
import { GrabbingSheet } from "./GrabbingSheet";
import type { Geometry, PlacedFocusBox, Screenful } from "./placement";
import { contentsOf, raised, TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import { StripEnd } from "./StripEnd";
import { stripEndOf } from "./strip-end";
import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets, TabTarget, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import type { NodeRef } from "./tree/path";
import { focusedWindowIn } from "./tree/tiling";
import { keyOf, useFocusGlows } from "./useFocusGlows";
import type { DrawnWindow } from "./useWindowMotion";
import { useWindowMotion } from "./useWindowMotion";
import { WindowFrame } from "./WindowFrame";
import { WindowTitleBar } from "./WindowTitleBar";
import type { ShellWindow } from "./window";
import { browserIdOf, WindowKind } from "./window";
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
export const Stage = ({
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
      screens.map(({ current, geometry, screenful: { placements, tabs } }) => [
        geometry.name,
        { activeId, current, placements, scratchpad, tabs, windows },
      ]),
    ),
  );
  const floats = screens.flatMap((screen) => screen.floats);
  const glows = useFocusGlows(focusBoxShowing(screens, activeId));
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
    tabs: tabTargets(screens),
    windows: targets,
  };
  return (
    <main className={stageStyles} data-stretching={stretching || undefined}>
      {/*
        Before every window, so each float covers its own shadow by document
        order. See `FloatShadow`. Skipped for fullscreen floats, whose shadow
        would spill onto the next display.
      */}
      {motions.drawn.map(({ motion, placement, restack, screen, window }) => {
        const float = floats.find((found) => floatHolds(found, window.id));
        return placement !== undefined &&
          !inFullscreen(screens, window.id) &&
          float !== undefined ? (
          <Sliding
            frame={placement.frame}
            key={window.id}
            on={screenNamed(screens, screen)}
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
      })}
      {/*
        Before every window too, so the windows at its depth cover all but its
        glow. Only the glow fading in follows the focused window's motion.
      */}
      {glows.map(({ box, leaving }) => {
        const following = leaving ? undefined : active;
        return (
          <Sliding
            frame={following?.placement?.frame}
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
          return (
            <WindowFrame
              frame={placement?.frame}
              key={window.id}
              onHover={(at) => {
                onHover(window.id, at);
              }}
              onReach={() => {
                onSelect(window.id);
              }}
              screen={on?.geometry.screen}
            >
              {window.kind === WindowKind.App ? (
                <AppWindow
                  appId={window.appId}
                  behindPanel={behindPanel}
                  clickThrough={clickThrough}
                  cursor={window.cursor}
                  depth={depth}
                  domicile={domicile}
                  dragging={stretching || window.id === movingId}
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
                  behindPanel={behindPanel}
                  clickThrough={clickThrough}
                  covered={placement?.behind !== undefined}
                  depth={depth}
                  domicile={domicile}
                  dragging={stretching || window.id === movingId}
                  focused={focused}
                  frame={placement?.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  isApp={window.isApp}
                  isPrivate={window.isPrivate}
                  motion={motion}
                  onIcon={onIcon}
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
            </WindowFrame>
          );
        },
      )}
      {/*
        The empty ends of tabbed strips, which drag a whole group. Before the
        bars, so the new-tab button over an end wins the `z-index` tie.
      */}
      {[
        ...motions.drawn.flatMap(({ motion, placement }) =>
          placement === undefined || isLeaving(motion) ? [] : [placement],
        ),
        ...motions.tabs.flatMap(({ motion, tab }) =>
          isLeaving(motion) ? [] : [{ ...tab, bar: tab.rect }],
        ),
      ].map(({ bar, depth, id, strip }) => {
        const end = stripEndOf(bar, strip);
        if (end === undefined || strip === undefined) {
          return undefined;
        } else {
          const floating = floats.find((float) => floatHolds(float, id));
          return (
            <StripEnd
              depth={strip.open ? raised(depth) : depth}
              float={floating}
              fullscreen={groupFills(screens, strip.group.windows)}
              group={strip.group}
              // By group: a strip's last tab and its parent strip's last tab can
              // name one window.
              key={`${strip.group.node.id}-${strip.group.node.up.toString()}`}
              onAim={setAim}
              onDrop={onDrop}
              onDropOn={(aim) => {
                onGroupDropOn(strip.group.node, aim);
              }}
              onFloat={() => {
                onGroupFloat(strip.group.node);
              }}
              onFullscreen={() => {
                onGroupFullscreen(strip.group.node);
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
              rect={end}
              targets={dropTargets}
            />
          );
        }
      })}
      {/*
        Every bar after every window's contents, so bars win the `z-index`
        tie by document order. A shown tab's contents tuck under its whole
        strip (see `SURFACE_TUCK`), including other windows' tabs. One
        component for tiled and floating, so the bar is not remounted when the
        window floats. See `WindowTitleBar`.
      */}
      {motions.drawn.map(
        ({ focused, motion, placement, restack, screen, window }) => {
          if (placement === undefined) {
            return undefined;
          } else {
            const on = screenNamed(screens, screen);
            const floating = floats.find((float) =>
              floatHolds(float, window.id),
            );
            // A hidden tab is not highlighted with its `focus parent` group, or
            // it would look open beside the shown tab. Container tabs are
            // handled below.
            const focus = titleFocus({
              hasKeyboard: focused,
              inSelection:
                placement.selected && placement.surface !== undefined,
              isTab: placement.tabbed !== undefined,
              shownByContainer: false,
            });
            const onMotionEnded = () => {
              motions.onPlayedOut(window.id, motion, screen);
            };
            return (
              <WindowFrame
                frame={placement.frame}
                key={window.id}
                onHover={(at) => {
                  onHover(window.id, at);
                }}
                onReach={() => {
                  onSelect(window.id);
                }}
                screen={on?.geometry.screen}
              >
                <WindowTitleBar
                  depth={placement.depth}
                  dragging={window.id === movingId}
                  float={floating}
                  focus={focus}
                  frame={placement.frame}
                  fullscreen={fillsScreen(screens, window.id)}
                  groupSelected={placement.selected}
                  icon={iconOf(window, clientIcons)}
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
                  onNewTab={() => {
                    onNewTab(window.id);
                  }}
                  rect={placement.bar}
                  restack={restack}
                  strip={placement.strip}
                  tabbed={placement.tabbed}
                  targets={dropTargets}
                  title={window.title}
                  window={window.id}
                />
              </WindowFrame>
            );
          }
        },
      )}
      {/*
        After every bar, so it covers the bars at its depth by document order.
      */}
      {screens.flatMap((on) => {
        const hanging = hangingOn(motions.drawn, on);
        return hanging?.placement === undefined
          ? []
          : [
              <ScratchpadBackdrop
                depth={hanging.placement.depth - 1}
                key={on.geometry.name}
                leaving={hanging.motion === "stowing"}
                onDismiss={() => {
                  onDismiss(hanging.window.id);
                }}
                screen={on.geometry.screen}
              />,
            ];
      })}
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
        them. None for fullscreen floats, alone or in a group. One set per
        float, since a floating group is one box.
      */}
      {motions.drawn.map(({ placement, screen, window }) => {
        const on = screenNamed(screens, screen);
        const floating = on?.floats.find(
          (float) => focusedWindowIn(float.root) === window.id,
        );
        return placement === undefined ||
          on === undefined ||
          floating === undefined ||
          inFullscreen(screens, window.id)
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
        const on = screenNamed(screens, screen);
        const named = windowNamed(windows, tab.id);
        return (
          <Sliding frame={undefined} key={tab.id} on={on}>
            <TitleBar
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
              })}
              // A tab is all its window shows, so it scales about its own
              // middle.
              frame={tab.rect}
              // Always false: a fullscreen workspace draws no tabs. See
              // `placement.ts`.
              fullscreen={fillsScreen(screens, tab.id)}
              group={{ layout: tab.group, windows: tab.windows }}
              groupSelected={tab.selected}
              icon={iconOf(named, clientIcons)}
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
              onNewTab={() => {
                onNewTab(tab.id);
              }}
              onPointerDown={() => {
                onSelect(tab.id);
              }}
              rect={tab.rect}
              strip={tab.strip}
              tabbed={tab.tabbed}
              title={named.title}
              window={tab.id}
            />
          </Sliding>
        );
      })}
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
};

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
}: {
  children: ReactNode;
  frame: Rect | undefined;
  on: StageScreen | undefined;
}) => (
  <div
    className={slidingStyles}
    style={on === undefined ? undefined : slidAcross(on.geometry.screen, frame)}
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

/** Whether the window `id` is fullscreen on its own. */
const fillsScreen = (screens: readonly StageScreen[], id: string): boolean =>
  screens.some(
    ({ fullscreen }) =>
      fullscreen?.group === false && fullscreen.windows.includes(id),
  );

/** Whether the window `id` is fullscreen, on its own or in a group. */
const inFullscreen = (screens: readonly StageScreen[], id: string): boolean =>
  screens.some(({ fullscreen }) => fullscreen?.windows.includes(id) === true);

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
  windows: readonly ShellWindow[],
  id: string,
): ShellWindow => {
  const window = windows.find((found) => found.id === id);
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
