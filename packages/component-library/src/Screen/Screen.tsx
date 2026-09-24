import type { PropsWithChildren } from "react";
import { css } from "../../styled-system/css";
import { coverTheWindow } from "./cover-the-window";
import { useDisplays } from "./DisplayProvider";
import type { Display } from "./display-source";

/**
 * Which displays a `<Screen>` covers. Mutually exclusive, so a call site
 * cannot ask for a name *and* everything and leave the answer to precedence.
 *
 * `everywhere` rather than the obvious `all`: Panda's extractor reads JSX
 * props on capitalized tags as style props, and `all` is a real CSS property,
 * so `<Screen all>` emitted `all: true` into the app's stylesheet and failed
 * the CSS minifier. A prop named for a CSS property is a trap in any component
 * this package exports.
 */
type Selection =
  | { everywhere: true; match?: undefined; name?: undefined }
  | {
      everywhere?: undefined;
      match: (display: Display) => boolean;
      name?: undefined;
    }
  | { everywhere?: undefined; match?: undefined; name: string };

/**
 * Puts its children over a display.
 *
 * Renders once per display it selects, so `everywhere` and `match` can produce
 * several and a `name` no display carries produces none — an unplugged screen
 * should cost the shell an empty region, not an error. Nothing renders until
 * the host has described the desktop.
 *
 * The page spans the whole desktop, so a screen is a region of it: the
 * rectangle comes straight from the display's normalized position and size.
 *
 * **Except where the page IS one screen, which is every page on a tty.** The
 * engine opens a browser window per CRTC there, so a region has to cover the
 * whole of its window rather than a part of the page — turned if the monitor
 * is on its side, and scaled if its pixels are denser than the box the shell
 * lays out in. That is a CSS `transform` on the region and nothing a shell
 * writes: `cover-the-window.ts` is the whole of it, and a shell goes on
 * placing a `<Screen>` exactly as it did.
 *
 * **And on such a page only that screen is drawn on, whatever is selected.**
 * A page of one window is told the whole desk — a shell decides things about
 * it that one monitor cannot answer — and may draw on exactly one monitor of
 * it. So `everywhere` is every screen of the desktop and one region here,
 * because the other monitors are other pages rendering this same tree. See
 * {@link onThisPage}.
 *
 * **A region's identity is its position in the selection, not its display.**
 * The regions one `<Screen>` renders are the same children placed over
 * different rectangles, so they are keyed by order: a desktop re-described
 * with a different display first restyles the region it already had rather
 * than tearing the subtree down and building it again, which is what a shell
 * with its chrome inside one needs. The cost is that a *multi-region*
 * selection shifts on removal — drop the first of two displays under
 * `everywhere` and the second's children carry on in the first's DOM node,
 * inheriting whatever state lived there. Harmless for the interchangeable
 * things `everywhere` is for; a shell wanting state to follow a particular
 * display keys it itself, off `data-screen`.
 *
 * **Positioned against the nearest positioned ancestor, so there must not be
 * one.** A `<Screen>` is placed in the desktop's coordinates, which are the
 * page's — the shell mounts it in normal flow and lets the initial containing
 * block do the work. Wrapping it in anything `relative`, `absolute` or
 * `fixed` silently reinterprets every position as an offset from that
 * wrapper, which looks like a desktop where every screen has slid.
 */
export const Screen = ({
  children,
  ...selection
}: PropsWithChildren<Selection>) => {
  const displays = useDisplays();
  return (
    <>
      {/* `undefined` and `[]` are deliberately different everywhere else — a
          handshake in flight is not a desktop with no screens — and this is
          the one place they collapse, because a `<Screen>` renders nothing for
          either. Kept as a default here rather than pushed into the context,
          so a shell that wants to tell them apart still can. */}
      {onThisPage(displays ?? [])
        .filter(selects(selection))
        .map((display, index) => (
          <div
            className={region}
            data-screen={display.name}
            // Keyed by position and not by name. A region is the same children
            // placed over a display, so the regions one `<Screen>` renders are
            // interchangeable: what differs between them is a rectangle, and a
            // rectangle is a style. A name key ties a region's identity to
            // *which* display it is, so a desktop re-described with a different
            // display first — a monitor unplugged, a config reloaded — tears the
            // subtree down and builds it again. For a shell whose chrome is on
            // one screen that is an embedded page reloaded to where it started
            // and every portal re-created blank, with nothing to show that it
            // happened. A shell wanting state per display keys it itself, off
            // `data-screen`.
            key={index}
            // Physical `left`/`top`/`width`/`height`, not the logical inset and
            // size properties: this is desktop geometry, and the left-hand
            // monitor stays on the left and stays landscape in a right-to-left
            // or vertical-writing locale.
            //
            // `transform` is what makes a monitor on its side draw on its side,
            // and it is `undefined` for every region that is a part of a page
            // rather than the whole of one — see `cover-the-window.ts`.
            //
            // `top left` for the same reason the four above are physical, and
            // it is load-bearing rather than a preference: every push in that
            // file is measured from the region's own top-left corner, and the
            // default origin is the center.
            style={{
              height: `${String(display.size[1])}px`,
              left: `${String(display.position[0])}px`,
              top: `${String(display.position[1])}px`,
              transform: coverTheWindow(display.size, display.scanout),
              transformOrigin: "top left",
              width: `${String(display.size[0])}px`,
            }}
          >
            {children}
          </div>
        ))}
    </>
  );
};

const region = css({
  position: "absolute",
});

/**
 * The displays this page may put a region on: the one its window covers, or
 * every display on a page that is the whole desktop.
 *
 * **A DESK OF SEVERAL MONITORS IS SEVERAL PAGES**, because one browser window
 * cannot span two CRTCs. Each of them is told the whole desk, moved so its own
 * display is at the origin — a shell decides things one monitor cannot answer,
 * like which screen the chrome goes on — and `scanout` is what marks the one
 * it is. Drawing the others would draw them *on top of this monitor*, since a
 * window's page has no coordinates outside itself, and it would put the
 * chrome and every window on every screen: a client's frame sink takes one
 * parent, so the last page to embed a window takes it off every other page,
 * and the terminal that keeps answering the keyboard stops drawing.
 *
 * Nothing is lost by it. The monitor a region was asked for is a page of its
 * own rendering this same tree, and it draws the region there.
 *
 * A desktop no page is a window of — a nested run, a plain browser — is every
 * display, which is the original behavior and the whole of the difference.
 */
const onThisPage = (displays: readonly Display[]): readonly Display[] => {
  const window = displays.find((display) => display.scanout !== undefined);
  return window === undefined ? displays : [window];
};

/**
 * The predicate one of the three mutually exclusive props asks for.
 *
 * `typeof … === "function"` rather than `!== undefined`: biome's
 * `style/noNegationElse` is an error here and rewrites the negated form's arms
 * back to front, which lands you in the *name* case having tested `match`.
 */
const selects =
  (selection: Selection) =>
  (display: Display): boolean => {
    if (selection.everywhere === true) {
      return true;
    } else if (typeof selection.match === "function") {
      return selection.match(display);
    } else {
      return display.name === selection.name;
    }
  };
