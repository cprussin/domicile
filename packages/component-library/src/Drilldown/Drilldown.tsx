import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import type { ReactNode } from "react";
import { useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

/** What slides in: a title over its content. */
export type DrilldownDetail = {
  title: string;
  content: ReactNode;
};

type Props = {
  /** The main view, shown while there is no detail. */
  children: ReactNode;
  /** What slides in over the main view, or `undefined` for none. */
  detail: DrilldownDetail | undefined;
  /** The back button was pressed: drop the detail. */
  onBack: () => void;
};

/**
 * A view that something slides in over from the side and back out of: a list
 * of choices for one row of the main view, with a back button above it — the
 * way a phone's settings go one level deeper without leaving the screen.
 *
 * For a panel that has no room for a second panel, or no business opening
 * one: a popover that a `Select`'s own popup would close, say.
 *
 * **The view that is not shown is not there**: `inert` and `aria-hidden`, so a
 * keyboard and a screen reader skip it, and out of the flow, so the panel is as tall as what
 * it shows. The detail that slid out is kept until the next one replaces it,
 * so it can slide out rather than vanish.
 *
 * Drawn in `currentcolor`, as `Slider` is.
 */
export const Drilldown = ({ children, detail, onBack }: Props) => {
  const [shown, setShown] = useState(detail);
  if (detail !== undefined && detail !== shown) {
    setShown(detail);
  }
  const open = detail !== undefined;
  return (
    <div className={rootStyles}>
      <div
        aria-hidden={open}
        className={paneStyles({ place: open ? "before" : "here" })}
        inert={open}
      >
        {children}
      </div>
      <div
        aria-hidden={!open}
        className={paneStyles({ place: open ? "here" : "after" })}
        inert={!open}
      >
        {shown !== undefined && (
          <>
            <div className={headerStyles}>
              <button
                aria-label="Back"
                className={backStyles}
                onClick={onBack}
                type="button"
              >
                <CaretLeftIcon size={14} />
              </button>
              <h3 className={titleStyles}>{shown.title}</h3>
            </div>
            {shown.content}
          </>
        )}
      </div>
    </div>
  );
};

const rootStyles = css({
  overflow: "hidden",
  position: "relative",
});

// The pane shown is in the flow; the other is laid over it, slid off to its
// side and hidden once it has gone — `visibility` waits out the slide.
const paneStyles = cva({
  base: {
    transition:
      "transform {durations.normal} {easings.out}, visibility {durations.normal}",
  },
  variants: {
    place: {
      after: {
        insetBlockStart: 0,
        insetInline: 0,
        position: "absolute",
        transform: "translateX(100%)",
        visibility: "hidden",
      },
      before: {
        insetBlockStart: 0,
        insetInline: 0,
        position: "absolute",
        transform: "translateX(-100%)",
        visibility: "hidden",
      },
      here: {
        position: "relative",
        transform: "translateX(0)",
        visibility: "visible",
      },
    },
  },
});

const headerStyles = hstack({
  gap: 1,
  paddingBlockEnd: 1.5,
});

const backStyles = css({
  _focusVisible: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
    outlineColor: "transparent",
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  padding: 0,
});

const titleStyles = css({
  fontSize: "sm",
  fontWeight: "semibold",
  margin: 0,
});
