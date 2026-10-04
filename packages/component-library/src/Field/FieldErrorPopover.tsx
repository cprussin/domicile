import { Field as BaseField } from "@base-ui/react/field";
import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";

type Props = {
  anchor: HTMLElement | undefined;
  error: ReactNode;
};

/**
 * A Field's error tooltip, to the right of `anchor`. Open while `error` is
 * defined.
 */
export const FieldErrorPopover = ({ anchor, error }: Props) => {
  // Keeps the last error so the text stays visible during the close
  // animation.
  const [shownError, setShownError] = useState<ReactNode>(error);
  useEffect(() => {
    if (error !== undefined) {
      setShownError(error);
    }
  }, [error]);
  return (
    <BasePopover.Root open={error !== undefined}>
      <BasePopover.Portal>
        <BasePopover.Positioner
          align="center"
          anchor={anchor}
          collisionAvoidance={{
            align: "none",
            fallbackAxisSide: "none",
            side: "none",
          }}
          side="right"
          sideOffset={8}
        >
          <BasePopover.Popup className={popupStyles}>
            <BasePopover.Arrow className={arrowStyles} />
            <BaseField.Error className={errorStyles} match={true}>
              {shownError}
            </BaseField.Error>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
};

const errorStyles = css({ margin: 0 });

// Fades, slides and scales out of the control's right edge.
//
// Both `_starting` and `[data-starting-style]` are set: `@starting-style` is
// unreliable for portaled elements, and base-ui's attribute covers that.
const popupStyles = css({
  _starting: {
    opacity: 0,
    scale: "0.7",
    translate: "-{spacing.4} 0",
  },
  "&[data-ending-style]": {
    opacity: 0,
    scale: "0.7",
    translate: "-{spacing.4} 0",
  },
  "&[data-starting-style]": {
    opacity: 0,
    scale: "0.7",
    translate: "-{spacing.4} 0",
  },
  backgroundColor: "danger",
  borderRadius: "sm",
  boxShadow: "md",
  color: "background",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "normal",
  letterSpacing: "normal",
  lineHeight: "normal",
  maxInlineSize: "min({spacing.80}, var(--available-width))",
  opacity: 1,
  outlineStyle: "none",
  paddingBlock: 1.5,
  paddingInline: 2,
  position: "relative",
  scale: "1",
  transformOrigin: "left center",
  transition:
    "opacity {durations.normal} {easings.out}, scale {durations.normal} {easings.out}, translate {durations.normal} {easings.out}",
  translate: "0 0",
});

// A left-pointing triangle. The polygon assumes `side: "right"`, which the
// positioner locks by disabling side collision avoidance. For other sides,
// derive the clip-path from base-ui's `[data-side]`.
//
// base-ui sets only `top` for a right-side arrow; `right: 100%` places it
// outside the popup's left edge. It has no animation of its own so it moves
// with the popup.
const arrowStyles = css({
  backgroundColor: "danger",
  blockSize: 2.5,
  clipPath: "polygon(100% 0, 100% 100%, 0 50%)",
  inlineSize: 2,
  right: "100%",
});
