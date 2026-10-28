import type { ReactNode } from "react";
import { useState } from "react";
import { css, cva } from "../../styled-system/css";
import { Panel } from "../Panel/Panel";

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
 * A main view with a detail view that slides in over it, as a `Panel` with
 * a back button. The detail puts controls in its header with `PanelAction`.
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
          <Panel onBack={onBack} title={shown.title}>
            {shown.content}
          </Panel>
        )}
      </div>
    </div>
  );
};

// Clips the pane sliding aside, but not the focus rings at its edges.
const rootStyles = css({
  overflow: "clip",
  overflowClipMargin: "{spacing.1}",
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
