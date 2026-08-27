import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { Button } from "@domicile/component-library/Button";
import { Input } from "@domicile/component-library/Input";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { css, cx } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { surfaceBox } from "./float";
import type { Floating } from "./shell-state";
import {
  clickThroughStyles,
  draggingStyles,
  floatPlacement,
  windowStyles,
} from "./window-styles";
import { withScheme } from "./with-scheme";

type Props = {
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
  /** Called with the address on show whenever the page navigates. */
  onNavigate: (url: string) => void;
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
 * A browser window on the stage: an address bar over a `<domicile-webview>`.
 *
 * The window is ordinary chrome, built from the same component library as the
 * rest of it — so the controls a browser needs cost nothing to style and match
 * every other control in the shell. The view element owns the navigation
 * itself; this is the chrome the user drives it with.
 */
export const BrowserWindow = ({
  clickThrough,
  dragging,
  floating,
  focused,
  onNavigate,
  onScreen,
  src,
}: Props) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<DomicileWebviewElement | null>(null);
  const [address, setAddress] = useState(src);

  // The page navigates on its own too — a link, a redirect — and the address
  // bar shows wherever it ended up, the way a browser's does.
  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const follow = (event: Event) => {
        const { url } = (event as CustomEvent<{ url: string }>).detail;
        setAddress(url);
        onNavigate(url);
      };
      view.addEventListener(WEBVIEW_NAVIGATE_EVENT, follow);
      return () => {
        view.removeEventListener(WEBVIEW_NAVIGATE_EVENT, follow);
      };
    }
  }, [onNavigate, view]);

  // The window the user is working in takes the keyboard, and a browser
  // window's belongs to its page rather than to the chrome around it.
  useEffect(() => {
    if (focused && view !== null) {
      view.focus();
    }
  }, [focused, view]);

  // Every control here drives the view element, which is rendered by this
  // component and so is attached by the time anyone can press one. A press
  // that finds no view is a wiring bug, not a case to absorb quietly.
  const withView = (command: (view: DomicileWebviewElement) => void): void => {
    if (view === null) {
      throw new Error("browser window: no view to drive");
    } else {
      command(view);
    }
  };

  const drive = (command: (view: DomicileWebviewElement) => void) => () => {
    withView(command);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    withView((loaded) => {
      loaded.src = withScheme(address);
    });
  };

  return (
    <section
      aria-label="Browser"
      className={cx(
        windowStyles,
        browserStyles,
        clickThrough && clickThroughStyles,
        dragging && draggingStyles,
      )}
      hidden={!onScreen}
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
      <domicile-webview className={viewStyles} ref={setView} src={src} />
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

// The page takes the height the address bar leaves, and gives it to the embed
// inside it rather than making the embed resolve a percentage against it — so
// the view is a column, which is what the embed's `flex` below grows into. The
// embed has no height of its own: Electron's `<webview>` is a shell around an
// iframe, and an iframe left to itself is 150px tall.
//
// The embed's own `display` is left alone on purpose: Electron ships
// `<webview>` as `display: flex` so the browsing context inside fills the tag,
// and overriding it collapses the page to nothing.
const viewStyles = flex({
  "& .domicile-webview-frame": {
    borderStyle: "none",
    flex: 1,
    minInlineSize: 0,
  },
  direction: "column",
  flex: 1,
  minBlockSize: 0,
});
