import { Toggle } from "@base-ui/react/toggle";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";

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
      <CaretRightIcon aria-hidden className={caretStyles} size={14} />
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
        <button
          aria-label={`${props.label} details`}
          className={moreStyles}
          onClick={props.onMore}
          type="button"
        >
          <CaretRightIcon aria-hidden size={14} />
        </button>
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

const tileStyles = cva({
  base: {
    _focusVisible: {
      outline: "{spacing.0.5} solid {colors.accent}",
      outlineOffset: 0.5,
    },
    alignItems: "center",
    backgroundColor: "color-mix(in oklab, currentcolor 10%, transparent)",
    borderRadius: "lg",
    borderStyle: "none",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    gap: 2,
    minBlockSize: 12,
    minInlineSize: 0,
    paddingInline: 2.5,
    textAlign: "start",
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    pressed: {
      false: {},
      true: { backgroundColor: "accent", color: "background" },
    },
  },
});

// Fills the tile but its arrow, so most of the tile switches.
const toggleStyles = css({
  _disabled: { cursor: "default" },
  _focusVisible: {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: 0.5,
  },
  alignItems: "center",
  alignSelf: "stretch",
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "flex",
  flex: 1,
  gap: 2,
  minInlineSize: 0,
  padding: 0,
  textAlign: "start",
});

const moreStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  marginInlineEnd: -1,
  padding: 0,
});

const caretStyles = css({ flexShrink: 0, marginInlineStart: "auto" });

const iconStyles = css({ display: "inline-flex", flexShrink: 0 });

const textStyles = css({
  display: "flex",
  flexDirection: "column",
  minInlineSize: 0,
  paddingBlock: 1.5,
});

const labelStyles = css({
  fontSize: "sm",
  fontWeight: "semibold",
  lineHeight: "tight",
});

const detailStyles = css({
  fontSize: "xs",
  lineHeight: "tight",
  opacity: "inactive",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
