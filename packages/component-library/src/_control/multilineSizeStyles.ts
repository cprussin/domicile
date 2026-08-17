import { cva } from "../../styled-system/css";

/**
 * Per-size text-layout values for the elements inside a multiline control
 * (Textarea + its prefix-icon stack). These must match the wrapped textarea's
 * own per-line metrics so the icon visually aligns with the first line of
 * text. Single-line Inputs inherit sizing from the `control` recipe's
 * `blockSize` instead.
 */
export const multilineSizeStyles = cva({
  variants: {
    size: {
      "2xl": {
        lineHeight: "{spacing.6.5}",
        minBlockSize: 16,
        paddingBlock: 4.75,
      },
      "3xl": {
        lineHeight: "{spacing.8}",
        minBlockSize: 22,
        paddingBlock: 7,
      },
      "4xl": {
        lineHeight: "{spacing.10}",
        minBlockSize: 30,
        paddingBlock: 10,
      },
      lg: { lineHeight: "{spacing.5.5}", minBlockSize: 10, paddingBlock: 2.25 },
      md: { lineHeight: "{spacing.5}", minBlockSize: 8, paddingBlock: 1.5 },
      sm: { lineHeight: "{spacing.4.5}", minBlockSize: 6, paddingBlock: 0.75 },
      xl: { lineHeight: "{spacing.6}", minBlockSize: 12, paddingBlock: 3 },
      xs: { lineHeight: "{spacing.4}", minBlockSize: 5, paddingBlock: 0.5 },
    },
  },
});
