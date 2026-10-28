import { cva } from "../../styled-system/css";

export const LAYOUTS = ["panel", "row", "glyph"] as const;
export type Layout = (typeof LAYOUTS)[number];

type Props = {
  /** What it is waiting for, in plain words: `Checking Wi-Fi…`. */
  children: string;
  /**
   * `panel` centers a spinner over its words in the room a waiting panel has;
   * `row` puts them on one line, under a list that is still filling; `glyph`
   * is the spinner alone, at a row's end, with the words for assistive tech.
   */
  layout?: Layout | undefined;
};

/** A spinner and what it is waiting for. Announced as it changes. */
export const Loading = ({ children, layout = "panel" }: Props) => (
  <span
    aria-label={layout === "glyph" ? children : undefined}
    className={rootStyles({ layout })}
    data-layout={layout}
    role="status"
  >
    <span aria-hidden className={spinnerStyles({ layout })} />
    {layout !== "glyph" && children}
  </span>
);

const rootStyles = cva({
  base: {
    alignItems: "center",
    color: "textSoft",
    display: "flex",
    textStyle: "panelDetail",
  },
  variants: {
    layout: {
      glyph: { display: "inline-flex", flexShrink: 0 },
      panel: {
        flex: 1,
        flexDirection: "column",
        gap: 2.5,
        justifyContent: "center",
        paddingBlock: 6,
      },
      // A row's inset, so the spinner lines up with the icons above it.
      row: { gap: 2, paddingBlock: 1.5, paddingInline: 2 },
    },
  },
});

// A ring of the divider with a quarter in the text's color. Under reduced
// motion it turns once and rests, and the words say what is happening.
const spinnerStyles = cva({
  base: {
    animation: "spin {durations.spin} {easings.linear} infinite",
    border: "{spacing.0.5} solid {colors.divider}",
    borderBlockStartColor: "currentcolor",
    borderRadius: "full",
    flexShrink: 0,
  },
  variants: {
    layout: {
      glyph: { blockSize: 3.5, inlineSize: 3.5 },
      panel: { blockSize: 5, inlineSize: 5 },
      row: { blockSize: 3.5, inlineSize: 3.5 },
    },
  },
});
