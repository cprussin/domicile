import { Toggle } from "@base-ui/react/toggle";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import type { Tone } from "../Popover/Popover";
import { Tooltip } from "../Tooltip/Tooltip";

type Props = {
  /** Why it is the way it is, such as what else keeps the screens on, in a tooltip. */
  detail?: string | undefined;
  /** Ignores presses, such as while a request is out. */
  disabled?: boolean | undefined;
  /** 16px, in the circle. */
  icon: ReactNode;
  /** Short, since it sits under the circle: "Night light". */
  label: string;
  onPressedChange: (pressed: boolean) => void;
  pressed: boolean;
  /** The tooltip's tone. */
  tone?: Tone | undefined;
};

/**
 * A quick settings switch for something turned on and off often, such as
 * the night light: an icon in a circle, in the accent color while on, over
 * its label. Several sit in a row, sharing it evenly.
 *
 * For what is nearly always on and has details, such as Wi-Fi, use a
 * `QuickTile`.
 */
export const QuickToggle = ({
  detail,
  disabled,
  icon,
  label,
  onPressedChange,
  pressed,
  tone = "overPhoto",
}: Props) => {
  const toggle = (
    <Toggle
      className={toggleStyles}
      disabled={disabled}
      onPressedChange={(next) => {
        onPressedChange(next);
      }}
      pressed={pressed}
    >
      <span aria-hidden className={circleStyles({ pressed })}>
        {icon}
      </span>
      <span className={labelStyles}>{label}</span>
    </Toggle>
  );
  return detail === undefined ? (
    toggle
  ) : (
    <Tooltip content={detail} tone={tone} trigger={toggle} />
  );
};

const toggleStyles = css({
  _disabled: { cursor: "default", opacity: "disabled" },
  _focusVisible: {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: 0.5,
  },
  _hover: { backgroundColor: "fillHover" },
  alignItems: "center",
  backgroundColor: "fill",
  borderRadius: "lg",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "flex",
  flex: "1 1 0",
  flexDirection: "column",
  font: "inherit",
  gap: 1.5,
  minInlineSize: 0,
  paddingBlock: 2.5,
  paddingInline: 1,
  transition: "background-color {durations.fast} {easings.default}",
});

const circleStyles = cva({
  base: {
    alignItems: "center",
    blockSize: 8,
    borderRadius: "full",
    display: "inline-flex",
    inlineSize: 8,
    justifyContent: "center",
    transition:
      "background-color {durations.fast} {easings.default}, color {durations.fast} {easings.default}",
  },
  variants: {
    pressed: {
      false: { backgroundColor: "fill" },
      true: { backgroundColor: "accent", color: "background" },
    },
  },
});

// Brighter while on, with its circle.
const labelStyles = css({
  "[aria-pressed=true] > &": { color: "inherit" },
  color: "textSoft",
  fontWeight: "medium",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelDetail",
  whiteSpace: "nowrap",
});
