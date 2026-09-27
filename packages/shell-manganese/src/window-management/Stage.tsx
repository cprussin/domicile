import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { Fragment, useState } from "react";

import type { Modifiers } from "../keyboard/useModifiers";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import type { Direction } from "./direction";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatShadow } from "./floating/FloatShadow";
import { FloatTitleBar } from "./floating/FloatTitleBar";
import type { Float } from "./floating/float";
import type { Screenful } from "./placement";
import { TILED } from "./placement";
import type { Spot } from "./pointer-warp";
import { SelectionRing } from "./SelectionRing";
import { selectionOf } from "./selection";
import { TitleBar } from "./TitleBar";
import type { Aim, Target } from "./tiled/aim";
import { DropIndicator } from "./tiled/DropIndicator";
import { TileGrab } from "./tiled/TileGrab";
import { titleFocus } from "./title-focus";
import { useWindowMotion } from "./useWindowMotion";
import type { ShellWindow } from "./window";
import { WindowKind } from "./window";

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
  /** The boxes of the floating windows on screen, by the window they belong to. */
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
  onResize: (id: string, width: number, height: number) => void;
  /** The user reached a window, by clicking into it or into its chrome. */
  onSelect: (id: string) => void;
  /** A tiled window's `edge` dragged `by` pixels, rightwards or downwards. */
  onStretch: (id: string, edge: Direction, by: number) => void;
  /** Where every window on screen goes, and the tabs of any container. */
  screenful: Screenful;
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
  screenful,
  windows,
}: Props) => {
  const { placements, tabs } = screenful;
  const selection = selectionOf(screenful, activeId, fullscreenId);
  const motions = useWindowMotion({
    activeId,
    current,
    placements,
    tabs,
    windows,
  });
  // Where a tiled window being moved would land, which is drawn over every
  // window rather than by the one being dragged — see `DropIndicator`.
  const [aim, setAim] = useState<Aim | undefined>(undefined);
  const targets = tiledTargets(placements);
  return (
    <main>
      {/*
        Before every window, so each float covers its own shadow on document
        order — see `FloatShadow`. Not for a float filling the screen, whose
        shadow would fall off the edge of it and onto the next display.
      */}
      {motions.drawn.map(({ motion, placement, window }) =>
        placement !== undefined &&
        window.id !== fullscreenId &&
        floats.some((float) => float.id === window.id) ? (
          <FloatShadow
            depth={placement.depth}
            dragging={window.id === draggingId}
            frame={placement.frame}
            key={window.id}
            motion={motion}
          />
        ) : undefined,
      )}
      {motions.drawn.map(({ focused, motion, placement, window }) => {
        const floating = floats.find((float) => float.id === window.id);
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
          (meta &&
            (floating !== undefined ||
              targets.some(({ id }) => id === window.id)));
        // A window with no placement is not on screen, so what it would stack
        // against is not a question: it is rendered hidden, which is what keeps
        // its portal and its page alive across a workspace switch.
        const depth = placement?.depth ?? 0;
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
                rect={placement?.surface}
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
                rect={placement?.surface}
                src={window.src}
              />
            );
          }
        }
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
      {motions.drawn.map(({ focused, motion, placement, window }) => {
        const floating = floats.find((float) => float.id === window.id);
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
        } else if (floating === undefined) {
          const grabbable = targets.some(({ id }) => id === window.id);
          return (
            <Fragment key={window.id}>
              <TitleBar
                depth={placement.depth}
                // A tiled window is dragged by the sheet below rather than by
                // its bar: an ordinary drag on a bar is a click on it, and
                // only the desktop's modifier picks a tiled window up.
                dragging={window.id === draggingId}
                focus={focus}
                frame={placement.frame}
                fullscreen={window.id === fullscreenId}
                motion={motion}
                onClose={onCloseThis}
                onFullscreen={onFullscreenThis}
                onMotionEnded={onMotionEnded}
                onReach={onReachThis}
                rect={placement.bar}
                title={window.title}
                window={window.id}
              />
              {grabbable && (meta || window.id === draggingId) && (
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
            </Fragment>
          );
        } else {
          return (
            <Fragment key={window.id}>
              <FloatTitleBar
                depth={placement.depth}
                dragging={window.id === draggingId}
                float={floating}
                focus={focus}
                frame={placement.frame}
                fullscreen={window.id === fullscreenId}
                motion={motion}
                onClose={onCloseThis}
                onDrop={onDrop}
                onFullscreen={onFullscreenThis}
                onGrab={onGrabThis}
                onMotionEnded={onMotionEnded}
                onMove={onMoveThis}
                onReach={onReachThis}
                rect={placement.bar}
                title={window.title}
              />
              {(meta || window.id === draggingId) && (
                <FloatGrab
                  depth={placement.depth}
                  float={floating}
                  onDrop={onDrop}
                  onGrab={onGrabThis}
                  onMove={onMoveThis}
                  onResize={(width, height) => {
                    onResize(window.id, width, height);
                  }}
                  resizes={shift}
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
          depth={0}
          // Nothing drags a tab: it belongs to a container, and a container is
          // tiled.
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
      {selection !== undefined && <SelectionRing selection={selection} />}
      {aim !== undefined && <DropIndicator rect={aim.rect} />}
    </main>
  );
};

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
