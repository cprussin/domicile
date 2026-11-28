import { cva } from "../../styled-system/css";

/**
 * The inline padding of a `rounded` control's wrapper: 1.5 spacing units more
 * than the recipe's (`CONTROL_PADDING_INLINE` in `control-sizes.ts`), so the
 * pill shape doesn't crowd its content. Values are literals because Panda's
 * static extractor can't read helper results.
 *
 * Only the padding: each wrapper sets its own `rounded` radius, which must
 * win over its other variants' radii in the same `cva`.
 */
export const roundedPadding = cva({
  compoundVariants: [
    { css: { paddingInline: 3 }, rounded: true, size: "xs" },
    { css: { paddingInline: 4 }, rounded: true, size: "sm" },
    { css: { paddingInline: 4.5 }, rounded: true, size: "md" },
    { css: { paddingInline: 5 }, rounded: true, size: "lg" },
    { css: { paddingInline: 5.5 }, rounded: true, size: "xl" },
    { css: { paddingInline: 7 }, rounded: true, size: "2xl" },
    { css: { paddingInline: 9 }, rounded: true, size: "3xl" },
    { css: { paddingInline: 11.5 }, rounded: true, size: "4xl" },
  ],
  variants: {
    rounded: { false: {}, true: {} },
    size: {
      "2xl": {},
      "3xl": {},
      "4xl": {},
      lg: {},
      md: {},
      sm: {},
      xl: {},
      xs: {},
    },
  },
});
