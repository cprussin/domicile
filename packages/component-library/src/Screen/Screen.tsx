import type { PropsWithChildren } from "react";
import { css } from "../../styled-system/css";
import { useDisplays } from "./DisplayProvider";
import type { Display } from "./display-source";

/**
 * Which displays a `<Screen>` covers. The options are mutually exclusive.
 *
 * Named `everywhere`, not `all`: Panda treats JSX props named after CSS
 * properties as style props, and `all: true` breaks the CSS minifier. Avoid
 * CSS property names for props in any exported component.
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
 * Renders its children over each selected display, as a region of the page.
 *
 * - Renders nothing for an unknown `name`, or before the host describes the
 *   desktop.
 * - Regions are keyed by order, not display, so a display change restyles a
 *   region instead of remounting it. With several regions, removing one
 *   shifts the next one's state into it; key on `data-screen` if state must
 *   follow a display.
 * - Positioned in page coordinates, so no ancestor may be positioned
 *   (`relative`, `absolute` or `fixed`).
 */
export const Screen = ({
  children,
  ...selection
}: PropsWithChildren<Selection>) => {
  const displays = useDisplays();
  return (
    <>
      {/* Renders nothing for both `undefined` and `[]`. The context keeps
          them distinct for shells that need to tell them apart. */}
      {(displays ?? []).filter(selects(selection)).map((display, index) => (
        <div
          className={region}
          data-screen={display.name}
          // Keyed by order so a display change doesn't remount the region,
          // which would reload embedded pages and reset portals.
          key={index}
          // Physical properties, since desktop geometry must not follow the
          // writing direction.
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
 * The display predicate for a `Selection`.
 *
 * Uses `typeof … === "function"` because biome's `style/noNegationElse`
 * rejects the negated `!== undefined` form.
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
