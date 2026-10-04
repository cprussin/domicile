import { cva } from "../../styled-system/css";

/**
 * Line metrics for each size of a multiline control and its prefix icon.
 *
 * Must match the textarea's metrics so the icon aligns with the first line.
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
