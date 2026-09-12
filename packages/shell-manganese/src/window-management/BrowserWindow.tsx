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
import { useEffect, useState } from "react";

import { css, cx } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { surfaceBox } from "./floating/float";
import { useHistoryAvailability } from "./useHistoryAvailability";
import type { Floating } from "./window-state";
import {
  clickThroughStyles,
  draggingStyles,
  floatEdgeStyles,
  floatPlacement,
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
  /** Whether the user has hold of this window, which makes it see-through. */
  dragging: boolean;
  /** How this window floats over the stage, or `undefined` while it is on it. */
  floating: Floating | undefined;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
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
   */
  onReach: () => void;
  /**
   * Whether this window is on screen at all.
   *
   * Not the same as being focused: a floating window is on screen whatever
   * else the user is doing, and a tabbed one is on screen only while its tab
   * is the selected one.
   */
  onScreen: boolean;
  /** Where the window starts. The view owns navigation from there. */
  src: string;
};

/**
 * A browser window on the stage: an address bar over a `<webview>`.
 *
 * The window is ordinary chrome, built from the same component library as the
 * rest of it — so the controls a browser needs cost nothing to style and match
 * every other control in the shell. The view element owns the navigation
 * itself; this is the chrome the user drives it with.
 */
export const BrowserWindow = ({
  domicile,
  clickThrough,
  dragging,
  floating,
  focused,
  onNavigate,
  onReach,
  onScreen,
  src,
}: Props) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  const [address, setAddress] = useState(src);
  const { canGoBack, canGoForward } = useHistoryAvailability(view);

  // The click in the page, which is the half of this window the shell cannot
  // see: the element dispatches this when its guest takes focus, because
  // nothing else about that click leaves the guest — see `onReach`.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const reached = () => {
        // The window the user is already in has nothing to report: it is the
        // focus the shell put there itself when the window became theirs.
        if (!focused) {
          onReach();
        }
      };
      view.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      return () => {
        view.removeEventListener(WEBVIEW_GUEST_FOCUS_EVENT, reached);
      };
    }
  }, [focused, onReach, view]);

  // The window the user is working in takes the keyboard, and a browser
  // window's belongs to its page rather than to the chrome around it.
  //
  // The host has to be told as well, which `<domicile-app>` does for itself and
  // this element cannot. There is one seat: the compositor holds `wl_keyboard`
  // focus on whichever client the chrome last named, and a browser window names
  // none — its page is inside the chrome's own window. Without `focusChrome`
  // the focus a terminal was given stays with it while the user types into a
  // site, and every key they press is delivered to a window they have switched
  // away from.
  useEffect(() => {
    if (focused && view !== null) {
      domicile.focusChrome();
      view.focus();
    }
  }, [domicile, focused, view]);

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
    // The window the user is already in has nothing to report: a focus in its
    // page is the one it was handed for being that window, and answering it
    // would ask the shell to reach what it has just reached.
    if (!focused) {
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
        clickThrough && clickThroughStyles,
        dragging && draggingStyles,
        // The bar above carries the top edge; this picks up the other three.
        floating !== undefined && floatEdgeStyles,
        floating !== undefined && noTopEdgeStyles,
      )}
      hidden={!onScreen}
      // Focus as well as the press, for the chrome's own controls: pressing
      // the address bar is a pointer event, and reaching it with the keyboard
      // is not. What happens in the page arrives on the element instead — see
      // `onReach`, and the effect above.
      onFocus={reach}
      onPointerDown={reach}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. `undefined` leaves the window
      // filling the stage, which is where a window that is not floating is.
      style={
        floating === undefined
          ? undefined
          : floatPlacement(surfaceBox(floating.float), floating.depth)
      }
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

// A floating browser window meets its title bar at the top, and the seam
// between the two is not a line to draw twice.
const noTopEdgeStyles = css({ borderBlockStartWidth: 0 });
