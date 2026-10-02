import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusChrome } from "@domicile/chrome-sdk/focus-chrome";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_GUEST_KEYDOWN_EVENT,
  WEBVIEW_NEW_WINDOW_EVENT,
  WEBVIEW_POPUP_WINDOW_EVENT,
  WEBVIEW_ZOOM_IN_REQUEST_EVENT,
  WEBVIEW_ZOOM_OUT_REQUEST_EVENT,
} from "@domicile/chrome-sdk/webview-element";
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
  focusedEdgeStyles,
  movingStyles,
  placedAt,
  restingEdgeStyles,
  scaledAbout,
  settlingStyles,
  shuffledBy,
  windowStyles,
} from "./window-styles";

type Props = {
  /**
   * Whether it is all the screen shows, alone or as a tab group — see
   * `showsOneThing` — which leaves its frame the resting color even while it
   * is focused: there is nothing else for it to be picked out from.
   */
  alone?: boolean;
  /**
   * How the window says a client no longer holds the keyboard.
   *
   * A browser window's keyboard is its page's, and its page is part of this
   * one — so taking focus here is a client somewhere losing it, and there is
   * nothing else in the tree that knows.
   */
  domicile: DomicileClient;
  /**
   * Whether the pointer goes through this window to the page behind it.
   *
   * What lets the shell drag a window at all: the pointer over a client's
   * surface belongs to the client, so the shell has to be given it back
   * before it can be told where the window is being dragged to.
   */
  clickThrough: boolean;
  /**
   * Whether a tab its container is showing is drawn over it. Nothing can be
   * clicked in a page under another, so its guest taking focus is never the
   * user reaching for it — see `onReach`.
   */
  covered: boolean;
  /** How it stacks: the window's own `z-index`, which the SDK reports. */
  depth: number;
  /** Whether the user has hold of this window, which makes it see-through. */
  dragging: boolean;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * The whole box this window's bar and contents span, which both of them turn
   * about — see {@link scaledAbout}. `undefined` for a window that is not on
   * screen, exactly as {@link Props.rect} is.
   */
  frame: Rect | undefined;
  /**
   * Whether this window fills the screen, which squares its corners and drops
   * its edge: the screen's own are the only ones it has.
   */
  fullscreen: boolean;
  /**
   * What this window is doing that the page has to draw over time: arriving,
   * leaving, or nothing at all.
   *
   * A window that is leaving is drawn and nothing else. Its page goes on being
   * shown — that is the point of drawing the window rather than something
   * standing in for it — while the window itself asks for no keyboard, takes
   * no pointer and is nothing a keyboard can reach.
   */
  motion: WindowMotion;
  /**
   * Called when the page asks for this window to close — its own
   * `window.close()`, or an extension's `chrome.tabs.remove`. The engine
   * closes nothing and asks, in `WEBVIEW_CLOSE_EVENT`, so the window goes the
   * way its Close button takes it.
   */
  onClose: () => void;
  /**
   * Called with the address this window was sent to, whenever the shell sends
   * it somewhere.
   *
   * Every navigation the shell can see, which is not every navigation: the
   * page inside is a guest in the browser process, and where a link or a
   * redirect takes it is not reported back — the engine pushes the guest's
   * history *availability* and whether it is *loading* onto the element, and
   * nothing that names an address. So a tab named from this says where the
   * user asked to go rather than where they ended up.
   */
  /**
   * Called when it has played that motion all the way out.
   *
   * Which is how the desktop knows a window it has closed can be taken off the
   * page. Rather than a timer: how long the motion takes is the stylesheet's,
   * and a duration written in the shell as well is a second copy of it to keep
   * in step.
   */
  onMotionEnded: () => void;
  onNavigate: (url: string) => void;
  /**
   * Called with the address the page inside this window asked to open in a
   * window of its own — a link with `target="_blank"`, a `window.open`.
   *
   * A second window, which is the desktop's to open and not this one's: this
   * component draws one window, and where another goes is the layout's
   * question. The browser process opens none either — a guest cannot be handed
   * a window content made — so an address that arrives here and is dropped is
   * a `target="_blank"` that does nothing at all.
   */
  onOpenWindow: (url: string) => void;
  /**
   * Called with the window an extension asked for — a
   * `chrome.windows.create` with a popup — when this is the window the user
   * was last working in, which is the one the engine asks.
   *
   * The desktop's to open, for {@link Props.onOpenWindow}'s reason. Dropped,
   * it is an extension's "Unlock" that does nothing, and a `windows.create`
   * that never answers.
   */
  onOpenPopupWindow: (request: PopupWindowRequest) => void;
  /**
   * Called when the focus lands anywhere in this window — the page, the
   * address bar — without this window having put it there.
   *
   * A press on the chrome is the frame's to report — see `WindowFrame` — but a
   * click inside the *page* is one the shell never sees: the view hosts a
   * browsing context of its own, so no pointer event crosses back out of it,
   * and neither does the focus that click takes — Blink dispatches no focus
   * event across a remote frame's boundary, and `focusin` fires only while the
   * page is focused, which is exactly what a guest taking focus ends. So the
   * element says so itself, in {@link WEBVIEW_GUEST_FOCUS_EVENT}, and the
   * window listens for that as well as for focus reaching its own chrome from
   * the keyboard.
   *
   * Reported for every click, including one in the window the user is already
   * in: focus follows the cursor here, so the pointer has already made this
   * the active window, and a click is still what raises it.
   */
  onReach: () => void;
  /**
   * The id of the extension's window this is, to `chrome.windows`, or
   * `undefined` for a browser window of the user's own — see
   * {@link Props.onOpenPopupWindow}.
   *
   * Read by the engine once, as the view asks for its guest, so it is the
   * view's from its first render and never changes: a view made again for it
   * would be a second guest. And an extension's window has no address bar,
   * which is how Chrome draws one: it is the extension's page, not somewhere
   * the user browses from.
   */
  popupWindow?: number | undefined;
  /**
   * Where the window's contents go, or `undefined` when it is not on screen
   * at all — on another workspace, or inside a container behind a tab.
   */
  rect: Rect | undefined;
  /**
   * The shuffle it is playing while it trades places with another float in
   * the stack — see `shuffledBy` — or `undefined` while it is not.
   */
  restack?: Restack | undefined;
  /** Where the window starts. The view owns navigation from there. */
  src: string;
};

/**
 * A browser window: an address bar over a `<webview>`.
 *
 * The window is ordinary chrome, built from the same component library as the
 * rest of it — so the controls a browser needs cost nothing to style and match
 * every other control in the shell. The view element owns the navigation
 * itself; this is the chrome the user drives it with.
 */
export const BrowserWindow = ({
  alone = false,
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
  // A window the desktop no longer has is being drawn and nothing else. What
  // it says about the keyboard and what it does about it part company here:
  // its bar goes on saying the keyboard was in it, which is what keeps the
  // window from changing while the user watches it go, and it stops reaching
  // for the keyboard itself — which has moved on to whatever is left.
  const leaving = isLeaving(motion);
  const holdsKeyboard = focused && !leaving;
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  // The whole window, which is what says whether the keyboard is in it: the
  // page is one half of this element's subtree and the chrome over it is the
  // other. A ref rather than state like the view above, because nothing reads
  // it as it arrives — it is read inside the effects, where the render that
  // set it has already been committed.
  const element = useRef<HTMLElement>(null);
  // Where the shell last SENT the window, which is not where the page is —
  // it is what the bar shows for the moment between asking for a page and the
  // browser reporting one, the way any browser shows a pending address. The
  // page itself comes from `useShownPage` below.
  const [sent, setSent] = useState(src);
  // AND WHERE THE PAGE ACTUALLY IS, with the browser's verdict on the
  // connection behind it. A link followed, a redirect taken, a form posted:
  // none of them is a navigation the shell made, and all of them move this.
  const shown = useShownPage(view);
  const { canGoBack, canGoForward } = useHistoryAvailability(view);
  const loading = useLoading(view);
  const zoom = useZoom(view);
  // How many times the user has zoomed this window, which is what puts the
  // zoom indicator up afresh each time — see `ZoomIndicator`.
  const [zoomsAnnounced, setZoomsAnnounced] = useState(0);
  // Whether the focus arriving in the page is the focus this window is putting
  // there, which is the one thing about it the announcements cannot say: the
  // element says a guest took focus whichever route the focus came by, and
  // `focusin` says as little. Held across the call rather than across a render,
  // because that is the span it has to tell apart — the engine dispatches from
  // inside `focus()`, and so does the DOM.
  const focusing = useRef(false);
  // THE FILE THE PAGE IS WAITING ON, which is this window's to pick: the
  // engine draws no dialog of its own and refuses a question nobody takes —
  // see `useFileRequest`.
  const asking = useFileRequest(view);
  // The picker's box, while there is a picker: where this window's keyboard
  // goes instead of the page, which is waiting on it. `null` for the ref API's
  // reason, as the view's is.
  const [pickerBox, setPickerBox] = useState<HTMLInputElement | null>(null);
  // WHETHER THE FIND BAR IS UP, and its box while it is: where the keyboard
  // goes when the user asks to find, and back to the page when they are done.
  // `null` for the ref API's reason, as the picker's is.
  const [finding, setFinding] = useState(false);
  const [findBox, setFindBox] = useState<HTMLInputElement | null>(null);
  const found = useFindResult(view);

  // Every focus this window puts in its own page — or in the picker over it —
  // goes through here, because each of them comes back as the announcement a
  // click there makes and the window has to spend the ones it caused.
  // Bracketing the call is what tells them apart: the element says so from
  // inside `focus()`, and so does the DOM.
  const focusOwn = useCallback((target: HTMLElement) => {
    focusing.current = true;
    target.focus();
    focusing.current = false;
  }, []);

  // The click in the page, which is the half of this window the shell cannot
  // see: the element dispatches this when its guest takes focus, because
  // nothing else about that click leaves the guest — see `onReach`.
  //
  // NOT FOR A PAGE UNDER ANOTHER TAB. The engine hands the focus back to the
  // guest that last had it when the page gets the keyboard back from a client
  // — which the launcher opening over one does — and announces that exactly
  // as it does a click. Answered, it raised the tab behind.
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

  // An extension asking for this window in front — `chrome.tabs.update` with
  // `active`, or `chrome.windows.update` with `focused` — which is a reach the
  // user did not make: the engine raises nothing, and asks. See
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

  // The page asking to be closed — see `onClose`.
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

  // A window the page asked for, which is the one thing this window hears from
  // its page that is not about this window: a link with `target="_blank"` opens
  // a second browser window, and where that goes is the desktop's to decide.
  // The engine reports the address rather than opening anything — see
  // `WEBVIEW_NEW_WINDOW_EVENT` — so a shell that ignores this is a desktop
  // where such a link does nothing.
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

  // A window an extension asked for, which is the same question from further
  // away: the engine heard it from an extension rather than from this page,
  // and asks the window the user last worked in because a question has to be
  // dispatched somewhere. Copied off the event so what reaches the desktop is
  // the ask rather than the event it came in.
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

  // WHAT A BROWSER'S KEYS AND ITS ZOOM DO, in one place, because three
  // different things ask for them: a chord pressed in the address bar, a chord
  // the page left alone and the engine handed back, and the buttons.
  //
  // A zoom is a step from wherever the element says the page IS, read at the
  // moment of the press rather than from a render: the zoom is the site's, so
  // another window on the same site can have moved it since.
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
          // A bar already up takes the keyboard again, with what it holds
          // selected so the next thing typed replaces it — Chrome's Ctrl+F.
          // One coming up takes it as it mounts; see the effect below.
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

  // The find bar takes the keyboard as it comes up: the user asked to find,
  // and what they type next is what to find.
  useEffect(() => {
    if (findBox !== null) {
      focusOwn(findBox);
    }
  }, [findBox, focusOwn]);

  // THE PAGE'S HALF OF THE KEYBOARD, which sends nothing out on its own: a key
  // pressed in a guest never reaches this document. The engine hands back the
  // chords the page left alone, and Ctrl and the wheel over the page as a
  // request, so a site that binds a chord for itself keeps it — Chrome's
  // order. See `WEBVIEW_GUEST_KEYDOWN_EVENT`.
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

  // The window the user is working in takes the keyboard, and a browser
  // window's belongs to its page rather than to the chrome around it.
  //
  // The host has to be told as well, which the SDK does for an `<app>` and
  // cannot do for this element. There is one seat: the compositor holds `wl_keyboard`
  // focus on whichever client the chrome last named, and a browser window names
  // none — its page is inside the chrome's own window. Without `focusChrome`
  // the focus a terminal was given stays with it while the user types into a
  // site, and every key they press is delivered to a window they have switched
  // away from.
  //
  // The SDK's `focusChrome` rather than the client's, because the page routes
  // keys too: the client's moves the seat and leaves the SDK forwarding every
  // key this document hears to the client it last named. The guest hides that
  // — the document hears none of its keys — until something of the page's own
  // takes typing, like the launcher's box, and every letter goes elsewhere.
  //
  // THE PAGE IS NOT WHERE IT GOES WHEN THIS WINDOW ALREADY HAS IT. A press in
  // the address bar is a reach like any other — it is what makes this the
  // window being worked in — so this runs on the focus that same press has
  // just taken, and a window that focused its page here would spend it: the
  // caret lands in the bar and is pulled into the page a moment later, which
  // is an address bar that cannot be typed into at all. What the user reached
  // for is already in this window, so there is nothing for this to move.
  //
  // A PICKER IS THE EXCEPTION, AND TAKES THE KEYBOARD WHEREVER IN THIS WINDOW
  // IT IS. The page is waiting on it, so a keyboard left in the page or in the
  // bar is typing into something that cannot go on until the picker is
  // answered. Once it is, the page has it back.
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

  // AND GIVES IT BACK WHEN THE USER MOVES ON, which nothing else in the
  // desktop can do for this window. Every key the compositor delivers arrives
  // in this document first and is forwarded from here to whichever client the
  // shell named — and a key pressed while a guest holds the page's focus never
  // arrives at all, because it is delivered inside a browsing context of its
  // own and the document around it hears nothing. Moving the seat does not
  // touch that: `focusApp` tells the compositor where to send what this page
  // forwards, and this page is forwarding nothing. So a browser window left
  // holding the focus is a desktop where no other window can be typed into —
  // open a browser window and every terminal after it goes deaf.
  useEffect(() => {
    if (!holdsKeyboard) {
      releaseFocus(element.current);
    }
  }, [holdsKeyboard]);

  // And keeps it, which is a separate job: the effect above runs when this
  // window becomes the one being worked in, and the chrome can take the focus
  // off the page long after that without this window hearing anything. Closing
  // another window is the case that costs the user their keyboard — see
  // `useReclaimFocus`.
  //
  // Into the picker while there is one, for the reason above.
  useReclaimFocus<HTMLElement>(pickerBox ?? view, holdsKeyboard, focusOwn);

  // Every control here drives the view element, which is rendered by this
  // component and so is attached by the time anyone can press one. A press
  // that finds no view is a wiring bug, not a case to absorb quietly.
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

  // Focus arriving anywhere in this window is the user starting to work in it.
  const reach = (event: FocusEvent) => {
    // Whichever window was the active one: focus follows the cursor here, so
    // the pointer made this window the active one on its way in and a click is
    // still what raises it. The reaches that are not the user's are the focus
    // this window gives its own page — see `focusing` — and a page under
    // another tab taking it back, which the engine reports as a `focusin` on
    // the view as well as in its own event — see the effect above.
    if (!(focusing.current || (covered && event.target === view))) {
      onReach();
    }
  };

  // Put the find bar away and the keyboard back in the page it was finding in,
  // with the match it was on still selected — Escape in Chrome's.
  const stopFinding = () => {
    withView((loaded) => {
      loaded.stopFinding();
      focusOwn(loaded);
    });
    setFinding(false);
  };

  const navigate = (url: string) => {
    withView((loaded) => {
      // The attribute rather than the property: `src` is reflected, so on the
      // engine the two are one operation, and the attribute is the half that
      // exists whatever this page is running on. On a browser with no
      // `<webview>` the property would be a value hung off an unknown element
      // and the DOM would go on saying the address the window opened at.
      loaded.setAttribute("src", url);
      setSent(url);
    });
  };

  // WHAT THE WINDOW IS CALLED FOLLOWS THE PAGE, not the ask. The desktop names
  // a browser window after the site in it, and before the browser reported its
  // own address the only thing there was to name it after was wherever the
  // shell had last sent it — so a window whose page had followed a link went on
  // wearing the name of the page the user left.
  //
  // An effect rather than a call inside `navigate`, because most of what moves
  // a page is not `navigate`: the shell hears about a link the same way it
  // hears about a redirect, which is the element reporting a new page.
  //
  // AND A PAGE IS REPORTED ONCE, WHICH THE DEPENDENCIES ALONE WILL NOT DO. The
  // desktop builds `onNavigate` inline, so it is a new function on every
  // render and this effect runs on every render — and a second report of the
  // same page renames the window, which renders it again, which reports again.
  // The ref is what makes the page rather than the callback the thing that
  // decides, so the dependency array can go on telling the truth.
  const reported = useRef("");
  useEffect(() => {
    if (shown.url !== "" && shown.url !== reported.current) {
      reported.current = shown.url;
      onNavigate(shown.url);
    }
  }, [onNavigate, shown.url]);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a window is not a control and is not being made into one — these say the user moved the focus into it, which is what raises a window in any desktop, and answer a browser's chords pressed in its chrome
    <section
      aria-label="Browser"
      className={cx(
        windowStyles,
        browserStyles,
        // The bar above carries the top edge; this picks up the other three.
        // Neither a line nor rounded corners around the screen's own edge.
        !fullscreen && edgeStyles,
        !fullscreen && bottomCornerStyles,
        // And the same color the bar is drawn in, for the same reason.
        focused && !alone ? focusedEdgeStyles : restingEdgeStyles,
        noTopEdgeStyles,
        movingStyles({ motion }),
        (clickThrough || leaving) && clickThroughStyles,
        // A dragged window is written at a new box on every pointer move, so
        // it takes the box it is given rather than easing towards it. Its
        // colors go on easing either way — see `settlingStyles`.
        dragging && draggingStyles,
        settlingStyles({ dragging }),
      )}
      // What it is doing, as an attribute as well as an animation: the
      // desktop's own state is worth being able to read off the element.
      data-motion={motion}
      hidden={rect === undefined}
      // Nothing a keyboard can reach, for as long as it is only being drawn.
      inert={leaving}
      // Its own rather than one of the chrome's on its way up the document —
      // the spinner in the address bar turns for as long as a page is
      // arriving, and each turn of it ends.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          onMotionEnded();
        }
      }}
      // Focus rather than the press, which is the frame's: reaching the address
      // bar with the keyboard is no pointer event. What happens in the page
      // arrives on the element instead — see `onReach`, and the effect above.
      onFocus={reach}
      // The chrome's half of the keyboard: the same chords, pressed in the
      // address bar. Taken from the field once answered, so Ctrl+R in the bar
      // is a reload and not a keystroke the field goes on to do something with.
      onKeyDown={(event) => {
        const command = browserCommandFor(event);
        if (command !== undefined) {
          event.preventDefault();
          run(command);
        }
      }}
      ref={element}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. `undefined` is a window with no
      // rectangle, which is a window that is not on screen.
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
        The page, and the find bar and the picker it is waiting on over it: a
        box of their own so either covers the page and leaves the bar above it
        alone.
      */}
      <div className={pageStyles}>
        <webview
          className={viewStyles}
          // As an attribute on the first render, which React writes before it
          // puts the element in the document — the one moment the engine reads
          // it. See `popupWindow`.
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
            // A picker per question, so a second one starts on an empty box.
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
 * Whether the keyboard is already somewhere in this window.
 *
 * Either half counts, and the page counts because of the fork: a `<webview>`
 * whose guest has the focus is the embedder document's `activeElement` — that
 * is what patch 0011 is for — so a window whose page is being typed into
 * answers yes here the same way one whose address bar is answers yes.
 *
 * `null` for the window rather than `undefined` because that is what a React
 * ref holds before it is attached, and a window that is not in the document
 * holds nothing.
 */
const holdsFocus = (frame: HTMLElement | null): boolean =>
  frame?.contains(document.activeElement) === true;

/**
 * Take this document's focus off the window, if the window is holding it.
 *
 * A blur rather than a focus of something else, because the document is where
 * the keyboard belongs when no window holds it: the SDK listens for keys on
 * `document` and sends them to whichever client the shell named, and the page
 * a guest was typing into cannot hear them. Blink hands the embedder's own
 * frame the focus on the way out — `Element::blur` focuses the document's
 * frame as it clears the element — which is what moves the browser process's
 * focused frame tree back off the guest's.
 */
const releaseFocus = (frame: HTMLElement | null): void => {
  const held = document.activeElement;
  if (holdsFocus(frame) && held instanceof HTMLElement) {
    held.blur();
  }
};

const browserStyles = flex({
  // Its own, because `windowStyles` paints none: this window draws a page
  // rather than standing in for a client's surface, so it wants a ground.
  backgroundColor: "background",
  direction: "column",
  // So the page in the view is clipped to the frame's rounded bottom rather
  // than drawn square over it.
  overflow: "hidden",
});

// The page's box takes whatever height the address bar leaves, and is what
// the picker over the page is positioned in. A flex column of its own so the
// view inside it stretches the same way.
const pageStyles = flex({
  direction: "column",
  flex: 1,
  minBlockSize: 0,
  minInlineSize: 0,
  position: "relative",
});

// The view takes the whole of the page's box, which it has to be told to do:
// a `<webview>` is a replaced element with an intrinsic size, so one left to
// itself is 300x150 inside however tall a window it is put in.
//
// `min-block-size: 0` because `auto` on a flex item refuses to shrink below
// that intrinsic size, which is what would put the bottom of the page under the
// bottom of the window.
//
// The element's own `display` is left alone on purpose: the engine gives it
// one, and a flex item is blockified whatever it says.
const viewStyles = css({
  borderStyle: "none",
  flex: 1,
  minBlockSize: 0,
  minInlineSize: 0,
});

// A browser window meets its title bar at the top, and the seam between the
// two is not a line to draw twice.
const noTopEdgeStyles = css({ borderBlockStartWidth: 0 });

/**
 * The address the bar shows: where the page is, or where it was sent while
 * nothing has arrived there yet.
 *
 * A BROWSER SHOWS A PENDING ADDRESS, which is what the fallback is for and not
 * a gap being papered over. Between Enter and the first commit there is no
 * page to report, and a bar that blanked for that span would flicker on every
 * navigation. What keeps the fallback honest is that it moves no lock with it:
 * the security beside it is the browser's, and the browser says nothing about
 * a page it has not committed — so a pending address is shown with the
 * indicator that says exactly that.
 */
const addressOf = (shown: string, sent: string): string =>
  shown === "" ? sent : shown;
