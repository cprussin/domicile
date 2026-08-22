import type { PropsWithChildren } from "react";
import { css } from "../../styled-system/css";
import { useDisplays } from "./DisplayProvider";
import type { Display } from "./display-source";

/**
 * Which displays a `<Screen>` covers. Mutually exclusive, so a call site
 * cannot ask for a name *and* everything and leave the answer to precedence.
 *
 * `everywhere` rather than the obvious `all`: Panda's extractor reads JSX
 * props on capitalised tags as style props, and `all` is a real CSS property,
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
 * rectangle comes straight from the display's normalised position and size.
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
      {(displays ?? []).filter(selects(selection)).map((display) => (
        <div
          className={region}
          data-screen={display.name}
          key={display.name}
          // Physical `left`/`top`/`width`/`height`, not the logical inset and
          // size properties: this is desktop geometry, and the left-hand
          // monitor stays on the left and stays landscape in a right-to-left
          // or vertical-writing locale.
          style={{
            height: `${String(display.size[1])}px`,
            left: `${String(display.position[0])}px`,
            top: `${String(display.position[1])}px`,
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
