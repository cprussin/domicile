// The popup shared by `ContextMenu` and `Menu`.

import { css } from "../../styled-system/css";

export const positionerStyles = css({
  outlineStyle: "none",
  zIndex: "modal",
});

// Fades in rising off its anchor by 2px. `&[data-starting-style]` rather than
// Panda's `_starting`: `@starting-style` does not reliably fire for a
// portaled popup. See `Popover`.
export const popupStyles = css({
  "&:has([data-item-icon]:not(:empty)) [data-item-icon]": {
    display: "inline-flex",
  },
  "&:is([data-starting-style], [data-ending-style])": {
    opacity: 0,
    transform: "translateY(calc(-1 * {spacing.0.5}))",
  },
  "&:is([data-starting-style], [data-ending-style]):is([data-side=left], [data-side=inline-start])":
    {
      transform: "translateX({spacing.0.5})",
    },
  "&:is([data-starting-style], [data-ending-style]):is([data-side=right], [data-side=inline-end])":
    {
      transform: "translateX(calc(-1 * {spacing.0.5}))",
    },
  "&:is([data-starting-style], [data-ending-style])[data-side=top]": {
    transform: "translateY({spacing.0.5})",
  },
  "&[data-ending-style]": {
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  color: "foreground",
  display: "flex",
  flexDirection: "column",
  maxBlockSize: "var(--available-height)",
  minInlineSize: "{spacing.56}",
  opacity: 1,
  outlineStyle: "none",
  overflowY: "auto",
  paddingBlock: 1,
  transform: "none",
  transition:
    "opacity {durations.fast} {easings.out}, transform {durations.fast} {easings.out}",
});
