import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { focusChrome } from "@domicile-desktop/sdk/focus-chrome";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_GUEST_KEYDOWN_EVENT,
  WEBVIEW_NEW_WINDOW_EVENT,
  WEBVIEW_POPUP_WINDOW_EVENT,
  WEBVIEW_ZOOM_IN_REQUEST_EVENT,
  WEBVIEW_ZOOM_OUT_REQUEST_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import type { FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { css, cx } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { AddressBar } from "./browser/AddressBar";
import { BrowserCommand, browserCommandFor } from "./browser/browser-command";
import { FilePicker } from "./browser/FilePicker";
import { FindBar } from "./browser/FindBar";
import { useFileRequest } from "./browser/useFileRequest";
import { zoomedIn, zoomedOut } from "./browser/zoom-steps";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { useFindResult } from "./useFindResult";
import { useHistoryAvailability } from "./useHistoryAvailability";
import { useLoading } from "./useLoading";
import { useReclaimFocus } from "./useReclaimFocus";
import { useShownPage } from "./useShownPage";
import { useZoom } from "./useZoom";
import type { PopupWindowRequest } from "./window";
import type { WindowMotion } from "./window-motion";
import { isLeaving } from "./window-motion";
import {
  bottomCornerStyles,
  clickThroughStyles,
  draggingStyles,
  edgeStyles,
  movingStyles,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
  windowStyles,
} from "./window-styles";

type Props = {
  /**
   * Used to tell the host that no client holds the keyboard. The page lives in
   * the shell's own window, so focusing it takes focus from any client.
   */
  domicile: DomicileClient;
  /** Whether the pointer passes through this window, as during a drag. */
  clickThrough: boolean;
  /**
   * Whether another tab in its container covers it. A covered page cannot be
   * clicked, so its guest taking focus is not a user reach (see `onReach`).
   */
  covered: boolean;
  /** The window's `z-index`, which the SDK reports to the host. */
  depth: number;
  /** Whether the user is dragging this window. */
  dragging: boolean;
  /** Whether the shell considers this window focused. */
  focused: boolean;
  /**
   * The box spanning the title bar and contents; the transform origin (see
   * {@link scaledAbout}). `undefined` when {@link Props.rect} is.
   */
  frame: Rect | undefined;
  /** Whether this window is fullscreen, which removes its edge and corners. */
  fullscreen: boolean;
  /**
   * The window's current animation, if any.
   *
   * A leaving window keeps showing its page but requests no keyboard, takes
   * no pointer and is inert.
   */
  motion: WindowMotion;
  /**
   * Called when the page asks to close the window (`window.close()` or an
   * extension's `chrome.tabs.remove`). The engine only reports the request;
   * see `WEBVIEW_CLOSE_EVENT`.
   */
  onClose: () => void;
  /**
   * Called when the motion's animation ends, so a closed window can be
   * removed. Uses the animation event so the duration lives only in CSS.
   */
  onMotionEnded: () => void;
  /** Called with the page's URL each time the page reports a new one. */
  onNavigate: (url: string) => void;
  /**
   * Called with a URL the page asked to open in a new window
   * (`target="_blank"`, `window.open`). The engine opens nothing, so ignoring
   * this makes such links do nothing.
   */
  onOpenWindow: (url: string) => void;
  /**
   * Called with an extension's `chrome.windows.create` popup request. The
   * engine sends it to the last focused window. Ignoring it leaves the
   * extension's `windows.create` call unanswered.
   */
  onOpenPopupWindow: (request: PopupWindowRequest) => void;
  /**
   * Called when the user moves focus into this window (page or address bar).
   * Fires for every click, since a click raises the window even when it is
   * already focused.
   *
   * Clicks inside the guest page send no pointer or focus events to this
   * document, so the element reports them with
   * {@link WEBVIEW_GUEST_FOCUS_EVENT}.
   */
  onReach: () => void;
  /**
   * The `chrome.windows` id for an extension popup window, or `undefined` for
   * a normal browser window (see {@link Props.onOpenPopupWindow}). Popup
   * windows have no address bar, as in Chrome.
   *
   * The engine reads it once when creating the guest, so it must not change.
   */
  popupWindow?: number | undefined;
  /**
   * The contents' box, or `undefined` when off screen (another workspace, or
   * behind a tab).
   */
  rect: Rect | undefined;
  /** The restack shuffle in progress, if any. See `shuffledBy`. */
  restack?: Restack | undefined;
  /** The initial URL. The view owns navigation after that. */
  src: string;
};

/**
 * A browser window: an address bar over a `<webview>`. See
 * `docs/SHELL-BROWSER-WINDOWS.md` and
 * `packages/shell-manganese/docs/FOCUS-INTERNALS.md`.
 */
export const BrowserWindow = ({
  clickThrough,
  covered,
  depth,
  domicile,
  dragging,
  focused,
  frame,
  fullscreen,
  motion,
  onClose,
  onMotionEnded,
  onNavigate,
  onOpenPopupWindow,
  onOpenWindow,
  onReach,
  popupWindow,
  rect,
  restack,
  src,
}: Props) => {
  // A leaving window still draws as focused but stops taking the keyboard,
  // which has moved to the next window.
  const leaving = isLeaving(motion);
  const holdsKeyboard = focused && !leaving;
  // `null` because React passes `null` to a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  // The whole window, used to check whether focus is inside it. A ref because
  // only effects read it.
  const element = useRef<HTMLElement>(null);
  // The URL the shell last navigated to. The bar shows it until the page
  // reports its own URL.
  const [sent, setSent] = useState(src);
  // The page's actual URL and connection security, including navigations
  // the shell did not start (links, redirects, form posts).
  const shown = useShownPage(view);
  const { canGoBack, canGoForward } = useHistoryAvailability(view);
  const loading = useLoading(view);
  const zoom = useZoom(view);
  // Zoom count; each change re-shows the zoom indicator (see `ZoomIndicator`).
  const [zoomsAnnounced, setZoomsAnnounced] = useState(0);
  // True while `focusOwn` is calling `focus()`. Focus events fire
  // synchronously inside that call, so this marks them as not user reaches.
  const focusing = useRef(false);
  // A pending file request from the page. The engine draws no dialog; see
  // `useFileRequest`.
  const asking = useFileRequest(view);
  // The file picker's input. While open it takes the window's keyboard.
  const [pickerBox, setPickerBox] = useState<HTMLInputElement | null>(null);
  // Whether the find bar is open, and its input.
  const [finding, setFinding] = useState(false);
  const [findBox, setFindBox] = useState<HTMLInputElement | null>(null);
  const found = useFindResult(view);

  // Focuses an element in this window without reporting it as a user reach.
  // All programmatic focus here must go through this.
  const focusOwn = useCallback((target: HTMLElement) => {
    focusing.current = true;
    target.focus();
    focusing.current = false;
  }, []);

  // Reports a click in the guest page (see `onReach`).
  //
  // Ignored for a covered tab. When the page regains the keyboard (such as
  // when the launcher opens), the engine refocuses the last guest and fires
  // this event as if clicked, which would raise the hidden tab.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const reached = () => {
        if (!(focusing.current || covered)) {
          onReach();
        }
      };
      view.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      return () => {
        view.removeEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      };
    }
  }, [covered, onReach, view]);

  // An extension asked to raise this window (`chrome.tabs.update` with
  // `active`, or `chrome.windows.update` with `focused`). See
  // `WEBVIEW_FOCUS_REQUEST_EVENT`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      view.addEventListener(WEBVIEW_FOCUS_REQUEST_EVENT, onReach);
      return () => {
        view.removeEventListener(WEBVIEW_FOCUS_REQUEST_EVENT, onReach);
      };
    }
  }, [onReach, view]);

  // See `onClose`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      view.addEventListener(WEBVIEW_CLOSE_EVENT, onClose);
      return () => {
        view.removeEventListener(WEBVIEW_CLOSE_EVENT, onClose);
      };
    }
  }, [onClose, view]);

  // See `onOpenWindow` and `WEBVIEW_NEW_WINDOW_EVENT`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const asked = (event: DomicileNewWindowEvent) => {
        onOpenWindow(event.url);
      };
      view.addEventListener(WEBVIEW_NEW_WINDOW_EVENT, asked);
      return () => {
        view.removeEventListener(WEBVIEW_NEW_WINDOW_EVENT, asked);
      };
    }
  }, [onOpenWindow, view]);

  // See `onOpenPopupWindow`. Copies the fields so the callback gets a plain
  // object rather than the event.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const asked = ({
        height,
        url,
        width,
        windowId,
      }: DomicilePopupWindowEvent) => {
        onOpenPopupWindow({ height, url, width, windowId });
      };
      view.addEventListener(WEBVIEW_POPUP_WINDOW_EVENT, asked);
      return () => {
        view.removeEventListener(WEBVIEW_POPUP_WINDOW_EVENT, asked);
      };
    }
  }, [onOpenPopupWindow, view]);

  // Runs a browser command from a chord in the address bar, a chord the page
  // did not handle, or a button.
  //
  // Zoom steps from `view.zoom` at press time, not render state, because zoom
  // is per site and another window may have changed it.
  const run = useCallback(
    (command: BrowserCommand) => {
      if (view === null) {
        throw new Error("browser window: no view to drive");
      } else {
        switch (command) {
          case BrowserCommand.Back: {
            view.goBack();
            break;
          }
          // An open bar refocuses with its text selected, as in Chrome. A new
          // bar focuses on mount; see the effect below.
          case BrowserCommand.Find: {
            setFinding(true);
            if (findBox !== null) {
              focusOwn(findBox);
              findBox.select();
            }
            break;
          }
          case BrowserCommand.Forward: {
            view.goForward();
            break;
          }
          case BrowserCommand.Reload: {
            view.reload();
            break;
          }
          case BrowserCommand.ZoomIn: {
            view.setZoom(zoomedIn(view.zoom));
            setZoomsAnnounced((count) => count + 1);
            break;
          }
          case BrowserCommand.ZoomOut: {
            view.setZoom(zoomedOut(view.zoom));
            setZoomsAnnounced((count) => count + 1);
            break;
          }
          case BrowserCommand.ZoomReset: {
            view.setZoom(1);
            setZoomsAnnounced((count) => count + 1);
            break;
          }
        }
      }
    },
    [findBox, focusOwn, view],
  );

  // Focuses the find bar when it opens.
  useEffect(() => {
    if (findBox !== null) {
      focusOwn(findBox);
    }
  }, [findBox, focusOwn]);

  // Keys pressed in the guest never reach this document. The engine forwards
  // chords the page did not handle, and Ctrl+wheel as zoom requests, so sites
  // keep their own bindings as in Chrome. See `WEBVIEW_GUEST_KEYDOWN_EVENT`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const pressed = (event: KeyboardEvent) => {
        const command = browserCommandFor(event);
        if (command !== undefined) {
          run(command);
        }
      };
      const zoomIn = () => {
        run(BrowserCommand.ZoomIn);
      };
      const zoomOut = () => {
        run(BrowserCommand.ZoomOut);
      };
      view.addEventListener(WEBVIEW_GUEST_KEYDOWN_EVENT, pressed);
      view.addEventListener(WEBVIEW_ZOOM_IN_REQUEST_EVENT, zoomIn);
      view.addEventListener(WEBVIEW_ZOOM_OUT_REQUEST_EVENT, zoomOut);
      return () => {
        view.removeEventListener(WEBVIEW_GUEST_KEYDOWN_EVENT, pressed);
        view.removeEventListener(WEBVIEW_ZOOM_IN_REQUEST_EVENT, zoomIn);
        view.removeEventListener(WEBVIEW_ZOOM_OUT_REQUEST_EVENT, zoomOut);
      };
    }
  }, [run, view]);

  // Gives the keyboard to the focused window's page.
  //
  // - Calls the SDK's `focusChrome` so the compositor stops sending keys to
  //   the last client and the SDK stops forwarding to it. The SDK does this
  //   for `<app>` but not for `<webview>`.
  // - Skips the page if focus is already in this window. Otherwise a click in
  //   the address bar would have its focus pulled into the page.
  // - Focuses the file picker instead while one is open, since the page is
  //   waiting on it.
  useEffect(() => {
    if (holdsKeyboard && view !== null) {
      focusChrome(domicile);
      if (pickerBox !== null) {
        focusOwn(pickerBox);
      } else if (!holdsFocus(element.current)) {
        focusOwn(view);
      }
    }
  }, [domicile, focusOwn, holdsKeyboard, pickerBox, view]);

  // Releases focus when the window loses it. The SDK forwards keys from this
  // document to clients, but keys sent to a focused guest never reach the
  // document. A guest left focused would block typing into every client.
  useEffect(() => {
    if (!holdsKeyboard) {
      releaseFocus(element.current);
    }
  }, [holdsKeyboard]);

  // Restores focus if chrome takes it later, such as when another window
  // closes. See `useReclaimFocus`. Targets the picker while one is open.
  useReclaimFocus<HTMLElement>(pickerBox ?? view, holdsKeyboard, focusOwn);

  // The view is attached before any control can be pressed, so a missing view
  // is a bug.
  const withView = (command: (view: HTMLWebViewElement) => void): void => {
    if (view === null) {
      throw new Error("browser window: no view to drive");
    } else {
      command(view);
    }
  };

  const drive = (command: (view: HTMLWebViewElement) => void) => () => {
    withView(command);
  };

  // Reports focus entering this window as a user reach.
  const reach = (event: FocusEvent) => {
    // Skips focus from `focusOwn` and a covered tab's guest regaining focus,
    // which also fires `focusin` on the view.
    if (!(focusing.current || (covered && event.target === view))) {
      onReach();
    }
  };

  // Closes the find bar and refocuses the page, keeping the current match
  // selected, as Escape does in Chrome.
  const stopFinding = () => {
    withView((loaded) => {
      loaded.stopFinding();
      focusOwn(loaded);
    });
    setFinding(false);
  };

  const navigate = (url: string) => {
    withView((loaded) => {
      // The attribute works without engine support; on a browser without
      // `<webview>` the property would not update the DOM.
      loaded.setAttribute("src", url);
      setSent(url);
    });
  };

  // Reports the page's actual URL, so the window is named after the page
  // shown. An effect because most navigations (links, redirects) do not go
  // through `navigate`.
  //
  // The ref reports each URL once. `onNavigate` is a new function each
  // render, and a repeat report would re-render and loop.
  const reported = useRef("");
  useEffect(() => {
    if (shown.url !== "" && shown.url !== reported.current) {
      reported.current = shown.url;
      onNavigate(shown.url);
    }
  }, [onNavigate, shown.url]);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a window is not a control; focus raises the window, and keydown runs browser chords pressed in its chrome
    <section
      aria-label="Browser"
      className={cx(
        windowStyles,
        browserStyles,
        // The title bar draws the top edge. Fullscreen has no edge or corners.
        !fullscreen && edgeStyles,
        !fullscreen && bottomCornerStyles,
        noTopEdgeStyles,
        movingStyles({ motion }),
        (clickThrough || leaving) && clickThroughStyles,
        // A dragged window gets a new box on every pointer move, so it skips
        // easing. Colors still ease; see `settlingStyles`.
        dragging && draggingStyles,
        settlingStyles({ dragging }),
      )}
      // Exposes the motion on the element for tests and debugging.
      data-motion={motion}
      hidden={rect === undefined}
      // A leaving window is unreachable by keyboard.
      inert={leaving}
      // Ignores animations bubbling up from descendants, such as the address
      // bar's loading spinner.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          onMotionEnded();
        }
      }}
      // Focus rather than press, so keyboard focus counts too. Page clicks
      // arrive through `WEBVIEW_GUEST_FOCUS_EVENT`; see `onReach`.
      onFocus={reach}
      // Browser chords pressed in the address bar. `preventDefault` keeps the
      // input from also handling them.
      onKeyDown={(event) => {
        const command = browserCommandFor(event);
        if (command !== undefined) {
          event.preventDefault();
          run(command);
        }
      }}
      ref={element}
      // Inline because the box is a runtime value Panda cannot extract.
      style={
        rect === undefined || frame === undefined
          ? undefined
          : {
              ...placedAt(rect, depth),
              ...scaledAbout(frame, rect),
              ...shuffledBy(restack),
            }
      }
    >
      {popupWindow === undefined && (
        <AddressBar
          address={addressOf(shown.url, sent)}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          loading={loading}
          onBack={drive((loaded) => {
            loaded.goBack();
          })}
          onForward={drive((loaded) => {
            loaded.goForward();
          })}
          onNavigate={navigate}
          onReload={drive((loaded) => {
            loaded.reload();
          })}
          onStop={drive((loaded) => {
            loaded.stop();
          })}
          onZoomIn={() => {
            run(BrowserCommand.ZoomIn);
          }}
          onZoomOut={() => {
            run(BrowserCommand.ZoomOut);
          }}
          onZoomReset={() => {
            run(BrowserCommand.ZoomReset);
          }}
          security={shown.security}
          visited={shown.visited}
          zoom={zoom}
          zoomsAnnounced={zoomsAnnounced}
        />
      )}
      {/*
        Wraps the page so the find bar and file picker cover the page but not
        the address bar.
      */}
      <div className={pageStyles}>
        <webview
          className={viewStyles}
          // React sets attributes before insertion, when the engine reads it.
          // See `popupWindow`.
          popupwindow={popupWindow?.toString()}
          ref={setView}
          src={src}
        />
        {finding && (
          <FindBar
            found={found}
            onClose={stopFinding}
            onFind={(text, backward) => {
              withView((loaded) => {
                loaded.find(text, backward);
              });
            }}
            ref={setFindBox}
          />
        )}
        {asking !== undefined && (
          <FilePicker
            // A new picker per request, so each starts empty.
            key={asking.serial}
            ref={setPickerBox}
            request={asking}
          />
        )}
      </div>
    </section>
  );
};

/**
 * Whether focus is anywhere in this window, page or chrome.
 *
 * The engine fork makes a `<webview>` with a focused guest the document's
 * `activeElement`, so page focus counts. `frame` is `null` before the ref
 * attaches.
 */
const holdsFocus = (frame: HTMLElement | null): boolean =>
  frame?.contains(document.activeElement) === true;

/**
 * Blurs the focused element if it is in this window.
 *
 * Blurring returns focus to the document, where the SDK listens for keys to
 * forward to clients. Blink's `Element::blur` also moves the browser process's
 * focused frame off the guest.
 */
const releaseFocus = (frame: HTMLElement | null): void => {
  const held = document.activeElement;
  if (holdsFocus(frame) && held instanceof HTMLElement) {
    held.blur();
  }
};

const browserStyles = flex({
  // Unlike a client surface, a page needs a background, and `windowStyles`
  // sets none.
  backgroundColor: "background",
  direction: "column",
  // Clips the page to the frame's rounded bottom corners.
  overflow: "hidden",
});

// Fills the height below the address bar and positions the overlays.
const pageStyles = flex({
  direction: "column",
  flex: 1,
  minBlockSize: 0,
  minInlineSize: 0,
  position: "relative",
});

// A `<webview>` is a replaced element with a 300x150 intrinsic size, so it
// must be stretched. `min-block-size: 0` lets it shrink below that size so
// the page does not overflow the window. `display` is unset because flex items
// are blockified anyway.
const viewStyles = css({
  borderStyle: "none",
  flex: 1,
  minBlockSize: 0,
  minInlineSize: 0,
});

// The title bar draws the top edge.
const noTopEdgeStyles = css({ borderBlockStartWidth: 0 });

/**
 * The address bar's URL: the page's URL, or the pending one before the first
 * commit.
 *
 * Avoids a blank bar during navigation. The security indicator still comes
 * from the browser, so a pending URL shows no lock.
 */
const addressOf = (shown: string, sent: string): string =>
  shown === "" ? sent : shown;
