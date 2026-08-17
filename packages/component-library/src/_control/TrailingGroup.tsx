import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactNode } from "react";
import { cva } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { Size } from "../control-sizes";

import { keepControlFocusedOnMouseDown } from "./focus";

type Props = {
  multiline?: boolean | undefined;
  onClear: () => void;
  rounded: boolean;
  showClearButton: boolean;
  size: Size;
  suffixButtons?: ReactNode | undefined;
  suffixIcon?: ReactNode | undefined;
};

export const TrailingGroup = ({
  multiline = false,
  onClear,
  rounded,
  showClearButton,
  size,
  suffixButtons,
  suffixIcon,
}: Props) => {
  const hasTrailingGroup =
    suffixButtons !== undefined ||
    suffixIcon !== undefined ||
    showClearButton === true;
  if (hasTrailingGroup === false) {
    return undefined;
  } else {
    const isPulled = suffixIcon === undefined;
    const clearAdjacent =
      suffixIcon !== undefined || suffixButtons !== undefined;
    return (
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focuses the control when clicking the gap; preventDefault on child mousedowns so suffix/clear buttons never steal focus from the control
      // biome-ignore lint/a11y/noStaticElementInteractions: focuses the control when clicking the gap; preventDefault on child mousedowns so suffix/clear buttons never steal focus from the control
      <span
        className={trailingGroupStyles({
          multiline,
          pulled: isPulled,
          rounded,
          size,
        })}
        onMouseDown={keepControlFocusedOnMouseDown}
      >
        {showClearButton && (
          <span className={clearWrapperStyles({ adjacent: clearAdjacent })}>
            <Button
              label="Clear"
              onClick={onClear}
              rounded
              size={size}
              variant="ghost"
            >
              <XIcon />
            </Button>
          </span>
        )}
        {suffixIcon !== undefined && (
          <span className={suffixIconStyles}>{suffixIcon}</span>
        )}
        {suffixButtons}
      </span>
    );
  }
};

// The pulled variant pulls the trailing group toward the wrapper edge by
// negating the wrapper's inline padding (so suffix buttons sit flush with
// the wrapper) while reserving 1 spacing unit of breathing room from the
// border. For the non-rounded base padding (xs:1.5, sm:2.5, md:3, lg:3.5,
// xl:4 — see `CONTROL_PADDING_INLINE` in `control-sizes.ts`), the offset is
// `1 - paddingInline`. For the rounded variant (which inflates padding by
// 1.5), the offset is `1 - (paddingInline + 1.5)`. Values inlined as
// literals so Panda's static extractor can emit the atomic classes —
// helper-returned compound variants are opaque to the extractor.
const clearWrapperStyles = cva({
  base: {
    display: "inline-flex",
    transform: "scale(0.7)",
  },
  variants: {
    adjacent: {
      true: { transformOrigin: "100% 50%" },
    },
  },
});

const suffixIconStyles = center({
  flexShrink: 0,
  inline: true,
  pointerEvents: "none",
  transition: "color {durations.fast} {easings.default}",
});

const trailingGroupStyles = cva({
  base: {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
  },
  compoundVariants: [
    {
      css: { marginInlineEnd: -0.5 },
      pulled: true,
      rounded: false,
      size: "xs",
    },
    {
      css: { marginInlineEnd: -1.5 },
      pulled: true,
      rounded: false,
      size: "sm",
    },
    { css: { marginInlineEnd: -2 }, pulled: true, rounded: false, size: "md" },
    {
      css: { marginInlineEnd: -2.5 },
      pulled: true,
      rounded: false,
      size: "lg",
    },
    { css: { marginInlineEnd: -3 }, pulled: true, rounded: false, size: "xl" },
    {
      css: { marginInlineEnd: -4.5 },
      pulled: true,
      rounded: false,
      size: "2xl",
    },
    {
      css: { marginInlineEnd: -6.5 },
      pulled: true,
      rounded: false,
      size: "3xl",
    },
    {
      css: { marginInlineEnd: -9 },
      pulled: true,
      rounded: false,
      size: "4xl",
    },
    { css: { marginInlineEnd: -2 }, pulled: true, rounded: true, size: "xs" },
    { css: { marginInlineEnd: -3 }, pulled: true, rounded: true, size: "sm" },
    {
      css: { marginInlineEnd: -3.5 },
      pulled: true,
      rounded: true,
      size: "md",
    },
    { css: { marginInlineEnd: -4 }, pulled: true, rounded: true, size: "lg" },
    {
      css: { marginInlineEnd: -4.5 },
      pulled: true,
      rounded: true,
      size: "xl",
    },
    {
      css: { marginInlineEnd: -6 },
      pulled: true,
      rounded: true,
      size: "2xl",
    },
    {
      css: { marginInlineEnd: -8 },
      pulled: true,
      rounded: true,
      size: "3xl",
    },
    {
      css: { marginInlineEnd: -10.5 },
      pulled: true,
      rounded: true,
      size: "4xl",
    },
  ],
  variants: {
    multiline: {
      true: {
        alignSelf: "flex-start",
        marginBlock: "-1px",
      },
    },
    pulled: {
      true: {},
    },
    rounded: {
      true: {},
    },
    size: {
      "2xl": { gap: 4, minBlockSize: 16 },
      "3xl": { gap: 5.5, minBlockSize: 22 },
      "4xl": { gap: 7.5, minBlockSize: 30 },
      lg: { gap: 1.5, minBlockSize: 10 },
      md: { gap: 1, minBlockSize: 8 },
      sm: { gap: 0.5, minBlockSize: 6 },
      xl: { gap: 2, minBlockSize: 12 },
      xs: { gap: 0.25, minBlockSize: 5 },
    },
  },
});
