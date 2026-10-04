import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import type { ReactNode } from "react";
import { useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

/** The detail view: a title and its content. */
export type DrilldownDetail = {
  title: string;
  content: ReactNode;
};

type Props = {
  /** The main view, shown while there is no detail. */
  children: ReactNode;
  /** The detail to show over the main view, or `undefined` for none. */
  detail: DrilldownDetail | undefined;
  /** Called when the back button is pressed; the caller drops the detail. */
  onBack: () => void;
};

/**
 * A main view with a detail view that slides in over it, with a back button.
 *
 * Use it where a second panel won't fit, e.g. inside a popover that a
 * `Select` popup would close. The hidden view is `inert`, `aria-hidden` and
 * out of the flow. The last detail stays rendered so it can slide out. Drawn
 * in `currentcolor`.
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

// The hidden pane overlays the shown one, slid aside. `visibility` changes
// after the slide ends.
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
