import type { AppFocusReleaseRequest } from "@domicile-desktop/sdk/app-element";
import {
  APP_FOCUS_RELEASE_REQUESTED_EVENT,
  APP_FOCUS_REQUESTED_EVENT,
} from "@domicile-desktop/sdk/app-element";
import type { CursorShape } from "@domicile-desktop/sdk/cursor-shape";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useRef, useState } from "react";

import { css, cx } from "../../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { Settler } from "./useSettling";
import { useSettling } from "./useSettling";
import { appWindowId } from "./window";
import type { WindowMotion } from "./window-motion";
import { isLeaving, isMoving } from "./window-motion";
import {
  bottomCornerStyles,
  clickThroughStyles,
  edgeStyles,
  movingStyles,
  originOf,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
  windowStyles,
} from "./window-styles";

/**
 * The box a window off screen reports. Empty, so the compositor stops its
 * client drawing; it keeps its last monitor.
 */
const OFF_SCREEN: Rect = { height: 0, width: 0, x: 0, y: 0 };

type Props = {
  /**
   * Whether a shell panel (such as the launcher) is open over the windows.
   * The page takes the keyboard while it is.
   */
  behindPanel: boolean;
  /**
   * Whether the pointer passes through this window to the page.
   *
   * Needed for drags: the client owns the pointer over its surface, so the
   * shell cannot track a drag over it otherwise.
   */
  clickThrough: boolean;
  /**
   * Whether the user is dragging or resizing this window, so its box follows
   * the pointer.
   */
  dragging: boolean;
  /** The host's id for this window's client. */
  appId: string;
  /**
   * The cursor the client requested. `undefined` uses the page's cursor.
   */
  cursor: CursorShape | undefined;
  /** The window's `z-index`, which the SDK reports to the host. */
  depth: number;
  /** Used to request keyboard focus. */
  domicile: DomicileHost;
  /**
   * The box spanning the title bar and contents; the transform origin (see
   * {@link scaledAbout}). `undefined` when {@link Props.rect} is.
   */
  frame: Rect | undefined;
  /** Whether the shell considers this window focused. */
  focused: boolean;
  /** Whether this window is fullscreen, which removes its edge and corners. */
  fullscreen: boolean;
  /**
   * Whether the compositor gives this window keyboard focus.
   *
   * Can differ from {@link Props.focused} when something else takes the
   * keyboard; the focus effect uses this to reclaim it.
   */
  hasKeyboard: boolean;
  /**
   * The window's current animation, if any.
   *
   * A leaving window is drawn only: it requests no keyboard, takes no pointer
   * and is inert.
   */
  motion: WindowMotion;
  /**
   * Called when the motion's animation ends, so a closed window can be
   * removed. Uses the animation event so the duration lives only in CSS.
   */
  onMotionEnded: () => void;
  /**
   * The contents' box, or `undefined` when off screen (another workspace, or
   * behind a tab).
   */
  rect: Rect | undefined;
  /** The restack shuffle in progress, if any. See `shuffledBy`. */
  restack?: Restack | undefined;
  /** Eases the window into a new box; see `useSettling`. */
  settler?: Settler | undefined;
};

/**
 * A Wayland client's window, rendered as an `<app>` element.
 *
 * Hiding the element takes the window off screen. The empty box it reports
 * then stops its client drawing.
 *
 * `<app>` has no hyphen, so React treats it as a plain HTML element and drops
 * unknown properties and `on…` listeners. Focus events are therefore bound
 * with `addEventListener` (as `BrowserWindow` does for `<webview>`), and
 * keyboard focus is requested in an effect.
 */
export const AppWindow = ({
  appId,
  behindPanel,
  clickThrough,
  cursor,
  depth,
  domicile,
  dragging,
  focused,
  frame,
  fullscreen,
  hasKeyboard,
  motion,
  onMotionEnded,
  rect,
  restack,
  settler,
}: Props) => {
  // A closed window that is still animating out.
  const leaving = isLeaving(motion);
  // `null` because React passes `null` to a callback ref on unmount.
  const [element, setElement] = useState<HTMLAppElement | null>(null);
  // The same element as a ref, which the layout effect in `useSettling` reads
  // before this render's state could reach it.
  const settling = useRef<HTMLAppElement | null>(null);
  const attach = useCallback((node: HTMLAppElement | null) => {
    settling.current = node;
    setElement(node);
  }, []);
  useSettling(
    settling,
    rect,
    rect === undefined || frame === undefined
      ? undefined
      : originOf(frame, rect),
    dragging || isMoving(motion),
    settler,
  );

  // Keeps the compositor's keyboard focus in line with the shell's.
  //
  // - Never sends an "unfocus" for an unfocused window; the keyboard always
  //   belongs to someone.
  // - Re-requests whenever `hasKeyboard` goes false, since clicking chrome
  //   (top bar, wallpaper) moves the keyboard to the page without changing the
  //   shell's focused window.
  // - Cannot loop: a granted `focusApp` sets `hasKeyboard`, and a refused one
  //   changes no dependency.
  // - Skips a leaving window, whose keyboard has moved to the next window.
  // - While a shell panel is open, takes the keyboard for the page. Otherwise
  //   the client under the launcher would receive its keystrokes. When the
  //   panel closes, the second branch returns focus without waiting for the
  //   pointer to move.
  useEffect(() => {
    if (behindPanel) {
      if (hasKeyboard) {
        domicile.focusChrome();
      }
    } else if (focused && !hasKeyboard && !leaving) {
      domicile.focusApp(appId);
    }
  }, [appId, behindPanel, domicile, focused, hasKeyboard, leaving]);

  // Tells the compositor where the window is, so the client draws at the
  // scale of the monitor under it. Keyed on the numbers, since `rect` is a new
  // object on every render.
  const { x, y, width, height } = rect ?? OFF_SCREEN;
  useEffect(() => {
    domicile.setAppBounds(appId, x, y, width, height);
  }, [appId, domicile, height, width, x, y]);

  // Cancels the engine's default focus-on-click. The shell owns focus:
  // `WindowFrame` reports the press and `focused` drives the effect above.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const asked = (event: Event) => {
        event.preventDefault();
      };
      element.addEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      return () => {
        element.removeEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      };
    }
  }, [element]);

  // The engine gives the keyboard to the page for a press off every `<app>`.
  // Cancels that for presses on this window's own chrome (title bar, grab
  // sheet), found by its `data-window` attribute, so dragging a window keeps
  // its keyboard.
  //
  // Compares the attribute rather than building a selector from the id,
  // since a client-chosen id with a quote would make the selector throw.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const releasing = (event: Event) => {
        const { pressed } = (event as CustomEvent<AppFocusReleaseRequest>)
          .detail;
        const chrome = pressed?.closest("[data-window]");
        if (chrome?.getAttribute("data-window") === appWindowId(appId)) {
          event.preventDefault();
        }
      };
      element.addEventListener(APP_FOCUS_RELEASE_REQUESTED_EVENT, releasing);
      return () => {
        element.removeEventListener(
          APP_FOCUS_RELEASE_REQUESTED_EVENT,
          releasing,
        );
      };
    }
  }, [appId, element]);

  return (
    <app
      app-id={appId}
      className={cx(
        windowStyles,
        appStyles,
        // Neither a line nor rounded corners around the screen's own edge.
        !fullscreen && edgeStyles,
        !fullscreen && bottomCornerStyles,
        movingStyles({ contents: true, motion }),
        (clickThrough || leaving) && clickThroughStyles,
        // The client's box takes its new size at once; `useSettling` eases
        // it. Colors still ease; see `settlingStyles`.
        settlingStyles({ box: "snapped" }),
      )}
      // Exposes the motion on the element for tests and debugging.
      data-motion={motion}
      hidden={rect === undefined}
      // A leaving window is unreachable by keyboard.
      inert={leaving}
      // Ignores animations bubbling up from descendants.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          onMotionEnded();
        }
      }}
      ref={attach}
      // Inline because the box and the cursor are runtime values that Panda
      // cannot extract at build time.
      style={{
        cursor,
        ...(rect === undefined || frame === undefined
          ? undefined
          : {
              ...placedAt(rect, depth),
              ...scaledAbout(frame, rect),
              ...shuffledBy(restack),
            }),
      }}
    />
  );
};

// The title bar draws the top edge, so the surface meets it flush.
const appStyles = css({ borderBlockStartWidth: 0 });
