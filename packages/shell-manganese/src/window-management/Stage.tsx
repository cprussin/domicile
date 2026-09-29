import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { Fragment, useState } from "react";

import { css } from "../../styled-system/css";

import type { Modifiers } from "../keyboard/useModifiers";
import { AppPopup } from "./AppPopup";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import type { Direction } from "./direction";
import { FloatBorder } from "./floating/FloatBorder";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatShadow } from "./floating/FloatShadow";
import type { Float } from "./floating/float";
import { floatHolds } from "./floating/float";
import { floatBordersOf } from "./floating/float-borders";
import type { Screenful } from "./placement";
import { contentsOf, TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import type { Popup } from "./popup";
import { popupsOver } from "./popup";
import type { Rect } from "./rect";
import { SelectionRing } from "./SelectionRing";
import { selectionOf } from "./selection";
import { TitleBar } from "./TitleBar";
import type { Aim, Target } from "./tiled/aim";
import { bordersOf } from "./tiled/borders";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileBorder } from "./tiled/TileBorder";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import { focusedWindowIn } from "./tree/tiling";
import { useWindowMotion } from "./useWindowMotion";
import { WindowTitleBar } from "./WindowTitleBar";
import type { ShellWindow } from "./window";
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
  /** The workspace on screen, which is what a switch is noticed against. */
  current: string;
  domicile: DomicileClient;
  /** The floating window the user has hold of, or `undefined` when none is. */
  draggingId: string | undefined;
  /** The boxes of the floating windows on screen, each holding one or a group. */
  floats: readonly Float[];
  /**
   * The window the compositor is typing into, or `undefined` when the chrome
   * is. Not the same as `activeId`: see `AppWindow`.
   */
  focusedId: string | undefined;
  /**
   * The window filling the screen, or `undefined` while none is.
   *
   * Which its own bar has to know, because the bar of a fullscreen window is
   * drawn over it: the button that took the screen is the one that gives it
   * back, and it says so.
   */
  fullscreenId: string | undefined;
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
  /** A browser window's page navigated, so its title says somewhere new. */
  onRename: (id: string, url: string) => void;
  onResize: (id: string, box: Rect) => void;
  /** The user reached a window, by clicking into it or into its chrome. */
  onSelect: (id: string) => void;
  /** A tiled window's `edge` dragged `by` pixels, rightwards or downwards. */
  onStretch: (id: string, edge: Direction, by: number) => void;
  /** The popups clients have open, drawn over the windows here they belong to. */
  popups: readonly Popup[];
  /** Where every window on screen goes, and the tabs of any container. */
  screenful: Screenful;
  /**
   * How wide the screen is, which is how far a workspace slides: the one
   * arriving comes in from a whole screen over, next to the one leaving.
   */
  width: number;
  windows: readonly ShellWindow[];
};

/**
 * Where the windows are: every one the workspace on screen has a rectangle
 * for, each at the rectangle the layout gave it.
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
  current,
  domicile,
  draggingId,
  floats,
  focusedId,
  fullscreenId,
  modifiers: { meta, shift },
  onClose,
  onDrop,
  onDropOn,
  onFullscreen,
  onGrab,
  onHover,
  onMove,
  onOpenWindow,
  onRename,
  onResize,
  onSelect,
  onStretch,
  popups,
  screenful,
  width,
  windows,
}: Props) => {
  const { placements, tabs } = screenful;
  const selection = selectionOf(screenful, activeId, fullscreenId, draggingId);
  const motions = useWindowMotion({
    activeId,
    current,
    placements,
    tabs,
    windows,
  });
  // The window being worked in as it is drawn, which is what the ring rings.
  const active = motions.drawn.find(({ window }) => window.id === activeId);
  // Where a tiled window being moved would land, which is drawn over every
  // window rather than by the one being dragged — see `DropIndicator`.
  const [aim, setAim] = useState<Aim | undefined>(undefined);
  // Whether a tiled window's border is being dragged. Not a grab: the window
  // is resized in place rather than picked up, so it is not dimmed — see
  // `stageStyles` for the rest of what this changes.
  const [stretching, setStretching] = useState(false);
  const targets = tiledTargets(placements);
  return (
    <main
      className={stageStyles}
      data-stretching={stretching || undefined}
      style={slidAcross(width)}
    >
      {/*
        Before every window, so each float covers its own shadow on document
        order — see `FloatShadow`. Not for a float filling the screen, whose
        shadow would fall off the edge of it and onto the next display.
      */}
      {motions.drawn.map(({ motion, placement, restack, window }) =>
        placement !== undefined &&
        window.id !== fullscreenId &&
        floats.some((float) => floatHolds(float, window.id)) ? (
          <FloatShadow
            depth={placement.depth}
            dragging={window.id === draggingId}
            frame={placement.frame}
            key={window.id}
            motion={motion}
            restack={restack}
          />
        ) : undefined,
      )}
      {motions.drawn.map(({ focused, motion, placement, restack, window }) => {
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
          motions.onPlayedOut(window.id, motion);
        };
        switch (window.kind) {
          case WindowKind.App: {
            return (
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
                fullscreen={window.id === fullscreenId}
                hasKeyboard={window.id === focusedId}
                key={window.id}
                motion={motion}
                onHover={(at) => {
                  onHover(window.id, at);
                }}
                onMotionEnded={onMotionEnded}
                onReach={() => {
                  onSelect(window.id);
                }}
                rect={contents?.rect}
                restack={restack}
              />
            );
          }
          case WindowKind.Browser: {
            return (
              <BrowserWindow
                clickThrough={clickThrough}
                depth={depth}
                domicile={domicile}
                dragging={window.id === draggingId}
                focused={focused}
                frame={placement?.frame}
                fullscreen={window.id === fullscreenId}
                key={window.id}
                motion={motion}
                onHover={(at) => {
                  onHover(window.id, at);
                }}
                onMotionEnded={onMotionEnded}
                onNavigate={(url) => {
                  onRename(window.id, url);
                }}
                onOpenWindow={onOpenWindow}
                onReach={() => {
                  onSelect(window.id);
                }}
                rect={contents?.rect}
                restack={restack}
                src={window.src}
              />
            );
          }
        }
      })}
      {/*
        The tiled windows' borders, which resize them with no modifier held.
        After the windows, so a border wins the pointer over the edge of the
        window it overlaps; before their chrome, so a bar keeps its own pixels
        and a held modifier's grab covers everything but the gaps.
      */}
      {bordersOf(targets).map(({ edge, id, rect }) => (
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
            onStretch(id, stretched, by);
          }}
          rect={rect}
        />
      ))}
      {/*
        And the floating windows' borders, the same way: at each one's own
        depth, so a window stacked over it covers its ring too. Not for a float
        filling the screen, which has no edge to drag. Once a float, by the
        window its own focus is on: a floating group is one box.
      */}
      {motions.drawn.map(({ placement, window }) => {
        const floating = floats.find(
          (float) => focusedWindowIn(float.root) === window.id,
        );
        return placement === undefined ||
          floating === undefined ||
          window.id === fullscreenId
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
                  onResize(window.id, box);
                }}
                rect={rect}
                window={window.id}
              />
            ));
      })}
      {/*
        After every window, so that a window's chrome and the window itself tie
        on `z-index` and the chrome wins on document order — while a window one
        place further up the stack still covers both.

        In the windows' order rather than the stacking order, which moves every
        time a float is raised. Stacking is expressed as `z-index` — see
        `placedAt` — so nothing about what covers what needs these in stacking
        order, and putting them in it costs a drag: a browser releases pointer
        capture when the capturing element is moved in the document, and taking
        hold of a window raises it.
      */}
      {motions.drawn.map(({ focused, motion, placement, restack, window }) => {
        const floating = floats.find((float) => floatHolds(float, window.id));
        const onCloseThis = () => {
          onClose(window.id);
        };
        const onReachThis = () => {
          onSelect(window.id);
        };
        const onFullscreenThis = () => {
          onFullscreen(window.id);
        };
        const onMoveThis = (x: number, y: number) => {
          onMove(window.id, x, y);
        };
        const onGrabThis = () => {
          onGrab(window.id);
        };
        const onMotionEnded = () => {
          motions.onPlayedOut(window.id, motion);
        };
        // A window's own bar has two states rather than three: the keyboard is
        // in the window or it is not. The third belongs to a container's tab,
        // below.
        const focus = titleFocus({
          hasKeyboard: focused,
          shownByContainer: false,
        });
        if (placement === undefined) {
          return undefined;
        } else {
          const grabbable = targets.some(({ id }) => id === window.id);
          return (
            <Fragment key={window.id}>
              {/*
                One bar for a tiled window and a floating one, so floating it
                keeps its bar rather than making a new one — see
                `WindowTitleBar`.
              */}
              <WindowTitleBar
                depth={placement.depth}
                dragging={window.id === draggingId}
                float={floating}
                focus={focus}
                frame={placement.frame}
                fullscreen={window.id === fullscreenId}
                motion={barMotion(motion)}
                onClose={onCloseThis}
                onDrop={onDrop}
                onFullscreen={onFullscreenThis}
                onGrab={onGrabThis}
                onMotionEnded={onMotionEnded}
                onMove={onMoveThis}
                onReach={onReachThis}
                rect={placement.bar}
                restack={restack}
                tabbed={placement.tabbed}
                title={window.title}
                window={window.id}
              />
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
                      onStretch(window.id, edge, by);
                    }}
                    resizes={shift}
                    targets={targets}
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
                    onMove={onMoveThis}
                    onResize={(box) => {
                      onResize(window.id, box);
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
      {motions.tabs.map(({ focused, motion, tab }) => (
        <TitleBar
          // With the float it is in, if it is in one.
          depth={tab.depth}
          // Nothing drags a tab: it belongs to a container, which moves with
          // its float or not at all.
          dragging={false}
          // The tab of a container the keyboard is not in is still the open
          // one, and saying so with the fill would be a second window claiming
          // the keystrokes.
          focus={titleFocus({
            hasKeyboard: focused,
            shownByContainer: tab.active,
          })}
          // A tab is the whole of what the window behind it has on screen, so
          // it turns about its own middle.
          frame={tab.rect}
          // A workspace showing a fullscreen window draws no tabs at all — see
          // `placement.ts` — so this one never names it.
          fullscreen={tab.id === fullscreenId}
          key={tab.id}
          motion={motion}
          onClose={() => {
            onClose(tab.id);
          }}
          onFullscreen={() => {
            onFullscreen(tab.id);
          }}
          onMotionEnded={() => {
            motions.onPlayedOut(tab.id, motion);
          }}
          onReach={() => {
            onSelect(tab.id);
          }}
          rect={tab.rect}
          title={titleOf(windows, tab.id)}
          window={tab.id}
        />
      ))}
      {/*
        And over all of it, what the commands are pointed at — after the
        windows and their bars, because it rings them: two elements at one
        `z-index` are decided by the order they come in the document.
      */}
      {selection !== undefined && (
        <SelectionRing
          // Around the window being worked in, which is the one a raise
          // shuffles over the others — so the ring shuffles with it.
          motion={active?.motion}
          restack={active?.restack}
          selection={selection}
        />
      )}
      {aim !== undefined && <DropIndicator rect={aim.rect} />}
      {/*
        Last, so a popup wins the tie with everything at its window's depth —
        the window, its bar and the ring — and stays under a window stacked
        above its own, as a menu of a window behind does.
      */}
      {popupsOver(popups, placements).map((popup) => (
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
 * The tiled windows on screen, which are what a tiled window can be picked up
 * from and dropped on: not one a tab is hiding, which has only its tab on
 * screen, and not one filling the screen, which has left the tiling's depth.
 */
const tiledTargets = (placements: Screenful["placements"]): readonly Target[] =>
  placements
    .filter(({ depth, surface }) => depth === TILED && surface !== undefined)
    .map(({ frame, id }) => ({ frame, id }));

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
