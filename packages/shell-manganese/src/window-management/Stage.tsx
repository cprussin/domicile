import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { Fragment } from "react";

import { css } from "../../styled-system/css";
import type { Modifiers } from "../keyboard/useModifiers";
import { AppWindow } from "./AppWindow";
import { BrowserWindow } from "./BrowserWindow";
import { FloatGrab } from "./floating/FloatGrab";
import { FloatTitleBar } from "./floating/FloatTitleBar";
import type { Float } from "./floating/float";
import type { ShellWindow } from "./window";
import { WindowKind } from "./window";
import { floatingOf } from "./window-state";

type Props = {
  /** The window the user is working in, which is not always the one on show. */
  activeId: string | undefined;
  domicile: DomicileClient;
  /** The floating window the user has hold of, or `undefined` when none is. */
  draggingId: string | undefined;
  /** The windows that have left the rail, back to front. */
  floats: readonly Float[];
  /** What the user is holding down, which decides who gets the pointer. */
  modifiers: Modifiers;
  onClose: (id: string) => void;
  onDrop: () => void;
  onGrab: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** A browser window's page navigated, so its tab says somewhere new. */
  onRename: (id: string, url: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  /** The user reached a window, by clicking into it or into its chrome. */
  onSelect: (id: string) => void;
  /** The tabbed window the stage shows, or `undefined` when none is. */
  shownId: string | undefined;
  windows: readonly ShellWindow[];
};

/**
 * Where windows are: the one the rail has selected, and every floating window
 * over it.
 *
 * One list, floating and tabbed alike, in the order they were opened. Two
 * lists would read better and cost a window its contents: React reconciles by
 * position, so a window moving from one to the other unmounts and remounts — a
 * portal re-created blank, and an embedded page reloaded to the URL it opened
 * at. Floating is a matter of where a window is laid out, so that is all that
 * changes here.
 */
export const Stage = ({
  activeId,
  domicile,
  draggingId,
  floats,
  modifiers: { alt, ctrl, shift },
  onClose,
  onDrop,
  onGrab,
  onMove,
  onRename,
  onResize,
  onSelect,
  shownId,
  windows,
}: Props) => (
  <main className={stageStyles}>
    {windows.map((window) => {
      const floating = floatingOf(floats, window.id);
      // On screen while it is floating whatever the stage is showing, and
      // while it is the one the stage shows.
      const onScreen = floating !== undefined || window.id === shownId;
      // While Alt (or Ctrl) is held the pointer belongs to the shell rather
      // than to the client, so a drag can be caught in the page. Only a
      // floating window for that: nothing drags one on the stage, and taking
      // the pointer off it would cost a click.
      //
      // While a drag runs it is every window, the stage's included. The
      // compositor hands the pointer to whichever window is under it, and the
      // windows a drag crosses are not the one being dragged: any of them that
      // still takes the pointer swallows the moves passing over it and the
      // release that should have ended the drag, leaving the window grabbed
      // with the mouse already let go.
      const clickThrough =
        draggingId !== undefined || (floating !== undefined && (alt || ctrl));
      switch (window.kind) {
        case WindowKind.App: {
          return (
            <AppWindow
              appId={window.appId}
              clickThrough={clickThrough}
              cursor={window.cursor}
              domicile={domicile}
              dragging={window.id === draggingId}
              floating={floating}
              focused={window.id === activeId}
              key={window.id}
              onReach={() => {
                onSelect(window.id);
              }}
              onScreen={onScreen}
            />
          );
        }
        case WindowKind.Browser: {
          return (
            <BrowserWindow
              clickThrough={clickThrough}
              domicile={domicile}
              dragging={window.id === draggingId}
              floating={floating}
              focused={window.id === activeId}
              key={window.id}
              onNavigate={(url) => {
                onRename(window.id, url);
              }}
              onReach={() => {
                onSelect(window.id);
              }}
              onScreen={onScreen}
              src={window.src}
            />
          );
        }
      }
    })}
    {/*
      After every window, so that the chrome of a float and the window it
      belongs to tie on `z-index` and the chrome wins on document order — while
      a window one place further up the stack still covers both.

      In the windows' order rather than the floats', which is the stacking
      order and moves every time a window is raised. Stacking is expressed as
      `z-index` — see `floatPlacement` — so nothing about what covers what
      needs these in stacking order, and putting them in it costs a drag: a
      browser releases pointer capture when the capturing element is moved in
      the document, and taking hold of a window raises it.
    */}
    {windows.map((window) => {
      const floating = floatingOf(floats, window.id);
      const onMoveThis = (x: number, y: number) => {
        onMove(window.id, x, y);
      };
      const onGrabThis = () => {
        onGrab(window.id);
      };
      return floating === undefined ? undefined : (
        <Fragment key={window.id}>
          <FloatTitleBar
            floating={floating}
            focused={window.id === activeId}
            onClose={() => {
              onClose(window.id);
            }}
            onDrop={onDrop}
            onGrab={onGrabThis}
            onMove={onMoveThis}
            title={window.title}
          />
          {(alt || ctrl || window.id === draggingId) && (
            <FloatGrab
              floating={floating}
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
    })}
  </main>
);

// The stage takes whatever the rail leaves, and every window in it fills the
// stage — the rail is what switches between them.
const stageStyles = css({
  flexGrow: 1,
  minInlineSize: 0,
  position: "relative",
});
