import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { WEBVIEW_GUEST_FOCUS_EVENT } from "@domicile/chrome-sdk/webview-element";
import { Button } from "@domicile/component-library/Button";
import { Input } from "@domicile/component-library/Input";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { css, cx } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import { useHistoryAvailability } from "./useHistoryAvailability";
import { useReclaimFocus } from "./useReclaimFocus";
import {
  clickThroughStyles,
  draggingStyles,
  edgeStyles,
  focusedEdgeStyles,
  placedAt,
  restingEdgeStyles,
  windowStyles,
} from "./window-styles";
import { withScheme } from "./with-scheme";

type Props = {
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
  /** How it stacks: the window's own `z-index`, which the SDK reports. */
  depth: number;
  /** Whether the user has hold of this window, which makes it see-through. */
  dragging: boolean;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * Called when the pointer moves into this window.
   *
   * Focus follows the cursor in this shell, so arriving over a window is the
   * user starting to work in it. The chrome is what hears it: a pointer inside
   * the page is the guest's, the same way a click there is.
   */
  onHover: () => void;
  /**
   * Called with the address this window was sent to, whenever the shell sends
   * it somewhere.
   *
   * Every navigation the shell can see, which is not every navigation: the
   * page inside is a guest in the browser process, and where a link or a
   * redirect takes it is not reported back — the engine pushes the guest's
   * history *availability* onto the element and nothing else about it. So a
   * tab named from this says where the user asked to go rather than where they
   * ended up.
   */
  onNavigate: (url: string) => void;
  /**
   * Called when the user clicks into this window — the page, the address bar,
   * anywhere in it.
   *
   * A click inside the *page* is one the shell never sees: the view hosts a
   * browsing context of its own, so no pointer event crosses back out of it,
   * and neither does the focus that click takes — Blink dispatches no focus
   * event across a remote frame's boundary, and `focusin` fires only while the
   * page is focused, which is exactly what a guest taking focus ends. So the
   * element says so itself, in {@link WEBVIEW_GUEST_FOCUS_EVENT}, and the
   * window listens for that as well as for its own chrome's pointer events.
   * Whichever arrives, this is the window the user is now working in.
   *
   * Reported for every click, including one in the window the user is already
   * in: focus follows the cursor here, so the pointer has already made this
   * the active window, and a click is still what raises it.
   */
  onReach: () => void;
  /**
   * Where the window's contents go, or `undefined` when it is not on screen
   * at all — on another workspace, or behind another window's tab.
   */
  rect: Rect | undefined;
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
  clickThrough,
  depth,
  domicile,
  dragging,
  focused,
  onHover,
  onNavigate,
  onReach,
  rect,
  src,
}: Props) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  // The whole window, which is what says whether the keyboard is in it: the
  // page is one half of this element's subtree and the chrome over it is the
  // other. A ref rather than state like the view above, because nothing reads
  // it as it arrives — it is read inside the effects, where the render that
  // set it has already been committed.
  const frame = useRef<HTMLElement>(null);
  const [address, setAddress] = useState(src);
  const { canGoBack, canGoForward } = useHistoryAvailability(view);
  // Whether the focus arriving in the page is the focus this window is putting
  // there, which is the one thing about it the announcements cannot say: the
  // element says a guest took focus whichever route the focus came by, and
  // `focusin` says as little. Held across the call rather than across a render,
  // because that is the span it has to tell apart — the engine dispatches from
  // inside `focus()`, and so does the DOM.
  const focusing = useRef(false);

  // Every focus this window puts in its own page goes through here, because
  // each of them comes back as the announcement a click there makes and the
  // window has to spend the ones it caused. Bracketing the call is what tells
  // them apart: the element says so from inside `focus()`, and so does the DOM.
  const focusPage = useCallback((page: HTMLWebViewElement) => {
    focusing.current = true;
    page.focus();
    focusing.current = false;
  }, []);

  // The click in the page, which is the half of this window the shell cannot
  // see: the element dispatches this when its guest takes focus, because
  // nothing else about that click leaves the guest — see `onReach`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const reached = () => {
        if (!focusing.current) {
          onReach();
        }
      };
      view.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      return () => {
        view.removeEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      };
    }
  }, [onReach, view]);

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
  // THE PAGE IS NOT WHERE IT GOES WHEN THIS WINDOW ALREADY HAS IT. A press in
  // the address bar is a reach like any other — it is what makes this the
  // window being worked in — so this runs on the focus that same press has
  // just taken, and a window that focused its page here would spend it: the
  // caret lands in the bar and is pulled into the page a moment later, which
  // is an address bar that cannot be typed into at all. What the user reached
  // for is already in this window, so there is nothing for this to move.
  useEffect(() => {
    if (focused && view !== null) {
      domicile.focusChrome();
      if (!holdsFocus(frame.current)) {
        focusPage(view);
      }
    }
  }, [domicile, focused, focusPage, view]);

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
    if (!focused) {
      releaseFocus(frame.current);
    }
  }, [focused]);

  // And keeps it, which is a separate job: the effect above runs when this
  // window becomes the one being worked in, and the chrome can take the focus
  // off the page long after that without this window hearing anything. Closing
  // another window is the case that costs the user their keyboard — see
  // `useReclaimFocus`.
  useReclaimFocus(view, focused, focusPage);

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

  // A click anywhere in this window is the user starting to work in it, and
  // the two halves of the window say so differently — a pointer event from the
  // chrome, and from the page nothing but the focus it took. Both land here.
  const reach = () => {
    // Every press, whichever window was the active one: focus follows the
    // cursor here, so the pointer made this window the active one on its way
    // in and a click is still what raises it. The one reach that is not the
    // user's is the focus this window gives its own page — see `focusing`.
    if (!focusing.current) {
      onReach();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    withView((loaded) => {
      const url = withScheme(address);
      // The attribute rather than the property: `src` is reflected, so on the
      // engine the two are one operation, and the attribute is the half that
      // exists whatever this page is running on. On a browser with no
      // `<webview>` the property would be a value hung off an unknown element
      // and the DOM would go on saying the address the window opened at.
      loaded.setAttribute("src", url);
      onNavigate(url);
    });
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a window is not a control and is not being made into one — these say the user clicked into it, which is what raises a window in any desktop, and there is no interactive element that could carry them: the page half of this window sends no pointer events at all
    <section
      aria-label="Browser"
      className={cx(
        windowStyles,
        browserStyles,
        // The bar above carries the top edge; this picks up the other three.
        edgeStyles,
        // And the same colour the bar is drawn in, for the same reason.
        focused ? focusedEdgeStyles : restingEdgeStyles,
        noTopEdgeStyles,
        clickThrough && clickThroughStyles,
        dragging && draggingStyles,
      )}
      hidden={rect === undefined}
      // Focus as well as the press, for the chrome's own controls: pressing
      // the address bar is a pointer event, and reaching it with the keyboard
      // is not. What happens in the page arrives on the element instead — see
      // `onReach`, and the effect above.
      onFocus={reach}
      onPointerDown={reach}
      // Focus follows the cursor: arriving anywhere in this window is the user
      // starting to work in it — the page excepted, because a pointer in there
      // is the guest's, the same way a click in it is.
      onPointerOver={onHover}
      ref={frame}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. `undefined` is a window with no
      // rectangle, which is a window that is not on screen.
      style={rect === undefined ? undefined : placedAt(rect, depth)}
    >
      <form className={addressBarStyles} onSubmit={handleSubmit}>
        <Button
          // A control that would do nothing says so before it is pressed:
          // `goBack()` on a history with nothing behind it is a no-op in the
          // browser process, and a live-looking button is this window offering
          // the user something it cannot do.
          disabled={!canGoBack}
          label="Back"
          onClick={drive((loaded) => {
            loaded.goBack();
          })}
          size="sm"
          variant="ghost"
        >
          <CaretLeftIcon size={16} />
        </Button>
        <Button
          disabled={!canGoForward}
          label="Forward"
          onClick={drive((loaded) => {
            loaded.goForward();
          })}
          size="sm"
          variant="ghost"
        >
          <CaretRightIcon size={16} />
        </Button>
        <Button
          label="Stop"
          onClick={drive((loaded) => {
            loaded.stop();
          })}
          size="sm"
          variant="ghost"
        >
          <XIcon size={16} />
        </Button>
        <Button
          label="Reload"
          onClick={drive((loaded) => {
            loaded.reload();
          })}
          size="sm"
          variant="ghost"
        >
          <ArrowClockwiseIcon size={16} />
        </Button>
        <div className={addressFieldStyles}>
          <Input
            aria-label="Address"
            onChange={(event) => {
              setAddress(event.target.value);
            }}
            prefixIcon={<GlobeSimpleIcon size={14} />}
            size="sm"
            spellCheck={false}
            value={address}
          />
        </div>
      </form>
      <webview className={viewStyles} ref={setView} src={src} />
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
});

const addressBarStyles = hstack({
  backgroundColor: "card",
  borderBlockEnd: "1px solid {colors.border}",
  flex: "none",
  gap: 1.5,
  paddingBlock: 1.5,
  paddingInline: 2,
});

// The field grows into whatever the controls leave; the Input itself fills
// whatever box it is given.
const addressFieldStyles = css({
  flexGrow: 1,
  minInlineSize: 0,
});

// The view takes whatever height the address bar leaves, which it has to be
// told to do: a `<webview>` is a replaced element with an intrinsic size, so
// one left to itself is 300x150 inside however tall a window it is put in.
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
