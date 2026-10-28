import { Toggle } from "@base-ui/react/toggle";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { IconButton } from "../IconButton/IconButton";

/** What every tile shows: `icon`, then `label` over `detail`. */
type Content = {
  /** A short status under the label, such as the network's name. */
  detail?: string | undefined;
  icon: ReactNode;
  /** Names the tile, and its toggle. */
  label: string;
};

/** A tile that switches something on and off, with details behind an arrow. */
type ToggleProps = Content & {
  /** Ignores presses, such as on a locked desktop. */
  disabled?: boolean | undefined;
  /** Opens the details; without it there is no arrow. */
  onMore?: (() => void) | undefined;
  onPressedChange: (pressed: boolean) => void;
  pressed: boolean;
};

/** A tile with nothing to switch, which opens its details. */
type MoreProps = Content & {
  onMore: () => void;
  onPressedChange?: undefined;
  pressed?: undefined;
};

type Props = ToggleProps | MoreProps;

/**
 * A quick settings tile: a labeled toggle in the accent color while on, and
 * an arrow to its details when it has some. A tile with nothing to switch is
 * one button that opens the details.
 *
 * Drawn in `currentcolor`, so it reads on a panel over the wallpaper.
 */
export const QuickTile = (props: Props) =>
  props.onPressedChange === undefined ? (
    <button
      aria-label={`${props.label} details`}
      className={tileStyles({ pressed: false })}
      onClick={props.onMore}
      type="button"
    >
      <Face detail={props.detail} icon={props.icon} label={props.label} />
      <span aria-hidden className={caretStyles}>
        <CaretRightIcon size={14} weight="bold" />
      </span>
    </button>
  ) : (
    <span className={tileStyles({ pressed: props.pressed })}>
      <Toggle
        aria-label={props.label}
        className={toggleStyles}
        disabled={props.disabled}
        onPressedChange={(pressed) => {
          props.onPressedChange(pressed);
        }}
        pressed={props.pressed}
      >
        <Face detail={props.detail} icon={props.icon} label={props.label} />
      </Toggle>
      {props.onMore !== undefined && (
        <IconButton label={`${props.label} details`} onClick={props.onMore}>
          <CaretRightIcon aria-hidden size={14} weight="bold" />
        </IconButton>
      )}
    </span>
  );

const Face = ({ detail, icon, label }: Content) => (
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

// The whole tile rings when the keyboard is on its toggle; the arrow rings
// itself.
const tileStyles = cva({
  base: {
    _focusVisible: {
      outline: "{spacing.0.5} solid {colors.accent}",
      outlineOffset: 0.5,
    },
    _hover: { backgroundColor: "fillHover" },
    "&:has(> [aria-pressed]:focus-visible)": {
      outline: "{spacing.0.5} solid {colors.accent}",
      outlineOffset: 0.5,
    },
    alignItems: "center",
    backgroundColor: "fill",
    borderRadius: "lg",
    borderStyle: "none",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    gap: 1,
    minBlockSize: 12,
    minInlineSize: 0,
    paddingInlineEnd: 1.5,
    paddingInlineStart: 2.5,
    textAlign: "start",
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    pressed: {
      false: {},
      true: {
        _hover: {
          backgroundColor:
            "color-mix(in oklab, {colors.accent} 88%, {colors.foreground})",
        },
        backgroundColor: "accent",
        color: "background",
      },
    },
  },
});

// Fills the tile but its arrow, so most of the tile switches.
const toggleStyles = css({
  _disabled: { cursor: "default" },
  alignItems: "center",
  alignSelf: "stretch",
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "flex",
  flex: 1,
  gap: 2.5,
  minInlineSize: 0,
  outlineStyle: "none",
  padding: 0,
  textAlign: "start",
});

// Where the toggle tile's arrow button sits, so both kinds line up.
const caretStyles = css({
  alignItems: "center",
  blockSize: 6,
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  marginInlineStart: "auto",
});

const iconStyles = css({ display: "inline-flex", flexShrink: 0 });

const textStyles = css({
  display: "flex",
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

// Softer than the label but still readable on the accent.
const detailStyles = css({
  color: "textSoft",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelDetail",
  whiteSpace: "nowrap",
});
