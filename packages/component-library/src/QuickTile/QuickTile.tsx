import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";

type Props = {
  /** A short status under the label, such as the network's name. */
  detail?: string | undefined;
  icon: ReactNode;
  /** Names the tile. */
  label: string;
  /** Opens the details; without it, such as on a locked desktop, the tile only shows its state. */
  onMore?: (() => void) | undefined;
};

/**
 * A quick settings tile into the details of something nearly always on,
 * such as Wi-Fi: its icon, label and status, and an arrow. The whole tile is
 * one button; its on/off switch lives in the details. Without details it only
 * shows its state.
 *
 * For something turned on and off often, use a `QuickToggle`.
 *
 * Drawn in `currentcolor`, so it reads on a panel over the wallpaper.
 */
export const QuickTile = ({ detail, icon, label, onMore }: Props) => {
  const face = (
    <>
      <span aria-hidden className={iconStyles}>
        {icon}
      </span>
      <span className={textStyles}>
        <span className={labelStyles}>{label}</span>
        {detail !== undefined && <span className={detailStyles}>{detail}</span>}
      </span>
    </>
  );
  return onMore === undefined ? (
    <span className={tileStyles({ still: true })}>{face}</span>
  ) : (
    <button
      aria-label={`${label} details`}
      className={tileStyles({ still: false })}
      onClick={onMore}
      type="button"
    >
      {face}
      <span aria-hidden className={caretStyles}>
        <CaretRightIcon size={14} weight="bold" />
      </span>
    </button>
  );
};

const tileStyles = cva({
  base: {
    alignItems: "center",
    backgroundColor: "fill",
    borderRadius: "lg",
    borderStyle: "none",
    color: "inherit",
    display: "flex",
    font: "inherit",
    gap: 2.5,
    minBlockSize: 12,
    minInlineSize: 0,
    paddingInlineEnd: 2,
    paddingInlineStart: 2.5,
    textAlign: "start",
  },
  variants: {
    // Shows a state, with nothing to press.
    still: {
      false: {
        _focusVisible: {
          outline: "{spacing.0.5} solid {colors.accent}",
          outlineOffset: 0.5,
        },
        _hover: { backgroundColor: "fillHover" },
        cursor: "pointer",
        transition: "background-color {durations.fast} {easings.default}",
      },
      true: {},
    },
  },
});

const caretStyles = css({
  color: "textFaint",
  display: "inline-flex",
  flexShrink: 0,
  marginInlineStart: "auto",
});

const iconStyles = css({ display: "inline-flex", flexShrink: 0 });

const textStyles = css({
  display: "flex",
  flex: 1,
  flexDirection: "column",
  gap: 0.5,
  minInlineSize: 0,
  paddingBlock: 2,
});

const labelStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelLabel",
  whiteSpace: "nowrap",
});

const detailStyles = css({
  color: "textSoft",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelDetail",
  whiteSpace: "nowrap",
});
