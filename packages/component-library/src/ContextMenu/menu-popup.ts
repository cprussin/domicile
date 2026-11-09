// The popup shared by `ContextMenu` and `Menu`.

import { css } from "../../styled-system/css";

export const positionerStyles = css({
  outlineStyle: "none",
  zIndex: "modal",
});

// `&[data-starting-style]` rather than Panda's `_starting`: `@starting-style`
// does not reliably fire for a portaled popup. See `Popover`.
export const popupStyles = css({
  "&:has([data-item-icon]:not(:empty)) [data-item-icon]": {
    display: "inline-flex",
  },
  "&[data-ending-style]": {
    opacity: 0,
    transition: "opacity {durations.fast} {easings.in}",
  },
  "&[data-starting-style]": {
    opacity: 0,
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
  transition: "opacity {durations.fast} {easings.out}",
});
