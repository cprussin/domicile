import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { Fragment } from "react";

import type { Modifiers } from "../keyboard/useModifiers";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatTitleBar } from "./floating/FloatTitleBar";
import type { Float } from "./floating/float";
import type { Placement, Screenful } from "./placement";
import { TitleBar } from "./TitleBar";
import type { ShellWindow } from "./window";
import { WindowKind } from "./window";

type Props = {
  /** The window the user is working in, which every bar is drawn against. */
  activeId: string | undefined;
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
  /** What the user is holding down, which decides who gets the pointer. */
  modifiers: Modifiers;
  onClose: (id: string) => void;
  onDrop: () => void;
  onGrab: (id: string) => void;
  /** The pointer moved into a window, which is the user working in it. */
  onHover: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** A browser window's page navigated, so its title says somewhere new. */
  onRename: (id: string, url: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  /** The user reached a window, by clicking into it or into its chrome. */
  onSelect: (id: string) => void;
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
 */
export const Stage = ({
  activeId,
  domicile,
  draggingId,
  floats,
  focusedId,
  modifiers: { meta, shift },
  onClose,
  onDrop,
  onGrab,
  onHover,
  onMove,
  onRename,
  onResize,
  onSelect,
  screenful: { placements, tabs },
  windows,
}: Props) => (
  <main>
    {windows.map((window) => {
      const placement = placementOf(placements, window.id);
      const floating = floats.find((float) => float.id === window.id);
      // While the desktop's modifier is held the pointer belongs to the shell
      // rather than to the client, so a drag can be caught in the page. Only
      // a floating window for that: nothing drags a tiled one, and taking the
      // pointer off it would cost a click.
      //
      // While a drag runs it is every window, the tiled ones included. The
      // compositor hands the pointer to whichever window is under it, and the
      // windows a drag crosses are not the one being dragged: any of them that
      // still takes the pointer swallows the moves passing over it and the
      // release that should have ended the drag, leaving the window grabbed
      // with the mouse already let go.
      const clickThrough =
        draggingId !== undefined || (floating !== undefined && meta);
      // A window with no placement is not on screen, so what it would stack
      // against is not a question: it is rendered hidden, which is what keeps
      // its portal and its page alive across a workspace switch.
      const depth = placement?.depth ?? 0;
      switch (window.kind) {
        case WindowKind.App: {
          return (
            <AppWindow
              appId={window.appId}
              clickThrough={clickThrough}
              cursor={window.cursor}
              depth={depth}
              domicile={domicile}
              dragging={window.id === draggingId}
              focused={window.id === activeId}
              hasKeyboard={window.id === focusedId}
              key={window.id}
              onHover={() => {
                onHover(window.id);
              }}
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
              focused={window.id === activeId}
              key={window.id}
              onHover={() => {
                onHover(window.id);
              }}
              onNavigate={(url) => {
                onRename(window.id, url);
              }}
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
    {windows.map((window) => {
      const placement = placementOf(placements, window.id);
      const floating = floats.find((float) => float.id === window.id);
      const onCloseThis = () => {
        onClose(window.id);
      };
      const onReachThis = () => {
        onSelect(window.id);
      };
      const onMoveThis = (x: number, y: number) => {
        onMove(window.id, x, y);
      };
      const onGrabThis = () => {
        onGrab(window.id);
      };
      if (placement === undefined) {
        return undefined;
      } else if (floating === undefined) {
        return (
          <TitleBar
            depth={placement.depth}
            focused={window.id === activeId}
            key={window.id}
            onClose={onCloseThis}
            onReach={onReachThis}
            rect={placement.bar}
            title={window.title}
            window={window.id}
          />
        );
      } else {
        return (
          <Fragment key={window.id}>
            <FloatTitleBar
              depth={placement.depth}
              float={floating}
              focused={window.id === activeId}
              onClose={onCloseThis}
              onDrop={onDrop}
              onGrab={onGrabThis}
              onMove={onMoveThis}
              onReach={onReachThis}
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
      one that container last had the focus in, and picking one is reaching for
      that window.
    */}
    {tabs.map((tab) => (
      <TitleBar
        depth={0}
        focused={tab.active}
        key={tab.id}
        onClose={() => {
          onClose(tab.id);
        }}
        onReach={() => {
          onSelect(tab.id);
        }}
        rect={tab.rect}
        title={titleOf(windows, tab.id)}
        window={tab.id}
      />
    ))}
  </main>
);

const placementOf = (
  placements: readonly Placement[],
  id: string,
): Placement | undefined => placements.find((found) => found.id === id);

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
