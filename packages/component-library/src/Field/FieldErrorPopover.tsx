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
 * Renders the right-side error tooltip for a Field. The popover anchors to
 * the wrapping control element and is shown only when `error` is defined;
 * the caller decides whether to forward the user's explicit `error` prop or
 * fall back to the platform `validationMessage`.
 */
export const FieldErrorPopover = ({ anchor, error }: Props) => {
  // The `error` prop drives the popover's open state — when it goes back
  // to `undefined` the popup starts its exit animation. But the popup's
  // *children* (the rendered error text) come from the live `error`
  // value, so if we used it directly the popup would have empty contents
  // the moment closing begins, while the popup chrome continues to
  // animate out. We mirror the last non-`undefined` error into local
  // state and feed *that* into the popup's children, so the error text
  // stays visible for the full close animation.
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

// Open / close animation: the popover fades + slides + scales out of
// the right side of the control, mirroring the leftward direction of
// the arrow that points back at it. Visually, the popup feels like it
// "emerges" from the control's edge on open and tucks back into it on
// close. `transform-origin: left center` puts the scale anchor at the
// arrow side so the growth direction matches the slide direction.
//
// Modern individual `scale` / `translate` properties (not the
// `transform` shorthand) so Panda's tokenized values resolve cleanly
// and the animations compose independently. Both `_starting` and
// `&[data-starting-style]` cover the entry case: the CSS at-rule
// fires for native popover mounts; the data attribute is base-ui's
// JS-driven equivalent and is the more reliable signal for portaled
// elements. The arrow is a positioned child of the popup and rides
// these transformations as part of the same unit — see the comment on
// `arrowStyles` below.
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

// Leftward-pointing triangle that points back at the control. The polygon
// is hard-coded for `side: "right"` and would render in the wrong direction
// if the popup ever flipped — the Positioner above is intentionally locked
// to `side: "right"` with `collisionAvoidance.side: "none"` to guarantee
// this. If you need the popover on other sides, derive the clip-path from
// base-ui's `[data-side]` attribute on the arrow element instead.
//
// base-ui's `PopoverArrow` applies `position: absolute; top: <y>;` (where
// `y` comes from Floating UI's arrow middleware to vertically align the
// arrow with the anchor) but leaves the horizontal axis unset for
// `side: "right"`. Without an explicit horizontal anchor the arrow defaults
// to `left: 0` inside the popup and overlays the text; `right: 100%` parks
// it just outside the popup's left edge so the flat side meets the popup
// and the tip points back at the control. Physical `right` matches the
// hard-coded physical `side: "right"`.
// The arrow has no animation of its own — it's a positioned child of
// the popup, so it inherits the popup's scale + translate + opacity as
// a rigid part of the same unit. Giving it a separate scale animation
// would compound with the popup's transform (popup-scale × arrow-scale),
// landing each one at different visual progress mid-animation and
// reading as two desynchronized motions. Letting the popup own the
// motion keeps the arrow and body locked together as a single group.
const arrowStyles = css({
  backgroundColor: "danger",
  blockSize: 2.5,
  clipPath: "polygon(100% 0, 100% 100%, 0 50%)",
  inlineSize: 2,
  right: "100%",
});
