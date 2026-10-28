import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { ROWS_REGULAR, TABS_REGULAR } from "../_icon/phosphor-parts";
import { SQUARE_SPLIT_REGULAR } from "../_icon/redrawn-parts";

/** How a group lays out its windows. */
export type GroupLayout = "column" | "row" | "stack" | "tabs";

/** Where the tabs stand, which they rise from. */
const TABS_BASE = [128, 176] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  layout: GroupLayout;
  size: number;
};

const shownIf = (shown: boolean) => (shown ? "shown" : "hidden");

/**
 * A group's layout, in Phosphor's regular icons: `SquareSplitHorizontal`
 * for a row, `SquareSplitVertical` for a column, `Rows` for a stack and
 * `Tabs` for tabs. When the layout changes the new one builds in: the divider draws
 * across, the rows drop in, the tabs rise.
 */
export const AnimatedLayoutIcon = ({ label, layout, size }: Props) => {
  const split = layout === "row" || layout === "column";
  return (
    <IconFrame label={label} size={size}>
      <IconPart
        d={SQUARE_SPLIT_REGULAR.frame}
        name="frame"
        state={shownIf(split)}
        stateStyles={fadeStyles}
      />
      <IconPart
        d={SQUARE_SPLIT_REGULAR.horizontal}
        name="divider"
        state={shownIf(layout === "row")}
        stateStyles={columnDividerStyles}
      />
      <IconPart
        d={SQUARE_SPLIT_REGULAR.vertical}
        name="divider"
        state={shownIf(layout === "column")}
        stateStyles={rowDividerStyles}
      />
      {ROWS_REGULAR.rows.map((d, index) => (
        <IconPart
          d={d}
          key={d}
          name="row"
          order={index}
          state={shownIf(layout === "stack")}
          stateStyles={rowStyles}
        />
      ))}
      <IconPart
        d={TABS_REGULAR.tabs}
        name="tabs"
        origin={TABS_BASE}
        state={shownIf(layout === "tabs")}
        stateStyles={tabsStyles}
      />
    </IconFrame>
  );
};

const fadeStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transition: "opacity {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transition: "opacity {durations.normal} {easings.out}",
  },
});

// Draws down from the middle, across the frame.
const columnDividerStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scaleY(0)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.fast} {easings.out} {durations.faster}, transform {durations.slow} {easings.out} {durations.faster}",
  },
});

const rowDividerStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scaleX(0)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.fast} {easings.out} {durations.faster}, transform {durations.slow} {easings.out} {durations.faster}",
  },
});

// Each row drops in after the one above it.
const rowStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translateY(-28px)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} calc({durations.faster} + var(--part-order) * {durations.faster}), transform {durations.slower} {easings.outBack} calc({durations.faster} + var(--part-order) * {durations.faster})",
  },
});

const tabsStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scaleY(0.4)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.faster}, transform {durations.slow} {easings.outBack} {durations.faster}",
  },
});
