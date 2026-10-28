import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import type { ReactNode } from "react";
import { Children, useId, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

export const SURFACES = ["plain", "filled"] as const;
export type Surface = (typeof SURFACES)[number];

type Common = {
  /** What goes under the row, across it, such as a field or a refusal. */
  children?: ReactNode | undefined;
  /** A second line, such as a device's battery. */
  detail?: ReactNode | undefined;
  /**
   * Folds `children` behind a toggle at the row's end, named this, such as
   * "Details" for a connection's addresses.
   */
  disclosure?: string | undefined;
  /** At the row's end: a figure, a pill, or, on a row that isn't pressed, buttons. */
  end?: ReactNode | undefined;
  /** 16px, before the label. */
  icon?: ReactNode | undefined;
  label: ReactNode;
  /**
   * `plain` rows sit on the panel and light under the pointer, as a list of
   * choices; `filled` rows are each a tile, as devices with their own
   * buttons.
   */
  surface?: Surface | undefined;
};

type Props = Common &
  (
    | {
        /** While its request is out. */
        busy?: boolean | undefined;
        /** Names the button, when its text alone would not. */
        name?: string | undefined;
        /** Makes the whole row one button. Its `end` must not be a control. */
        onPress: () => void;
      }
    | { busy?: undefined; name?: undefined; onPress?: undefined }
  );

/**
 * One row of a panel's list: an icon, a label over a detail, and something
 * at the end. A row is either one button, such as an inbox, or holds its own
 * buttons, such as a Bluetooth device. Goes in a {@link List}.
 *
 * The label and detail are cut short with an ellipsis rather than wrapping,
 * so rows keep one height.
 */
export const ListRow = ({
  busy,
  children,
  detail,
  disclosure,
  end,
  icon,
  label,
  name,
  onPress,
  surface = "plain",
}: Props) => {
  const below = Children.toArray(children).length > 0;
  const belowId = useId();
  const [unfolded, setUnfolded] = useState(false);
  const toggle = disclosure !== undefined && below && (
    <Button
      afterIcon={
        <CaretDownIcon
          aria-hidden
          className={caretStyles({ unfolded })}
          size={12}
          weight="bold"
        />
      }
      aria-controls={belowId}
      aria-expanded={unfolded}
      onClick={() => {
        setUnfolded(!unfolded);
      }}
      rounded
      size="xs"
      variant="ghost"
    >
      {disclosure}
    </Button>
  );
  const face = (
    <>
      {icon !== undefined && (
        <span aria-hidden className={iconStyles}>
          {icon}
        </span>
      )}
      <span className={textStyles}>
        <span className={labelStyles}>{label}</span>
        {detail !== undefined && <span className={detailStyles}>{detail}</span>}
      </span>
      {(end !== undefined || toggle !== false) && (
        <span className={endStyles}>
          {end}
          {toggle}
        </span>
      )}
    </>
  );
  return (
    <li
      className={itemStyles({ surface })}
      data-icon={icon === undefined ? undefined : ""}
      data-surface={surface}
    >
      {onPress === undefined ? (
        <div className={rowStyles({ pressable: false })}>{face}</div>
      ) : (
        <button
          aria-busy={busy === true ? true : undefined}
          aria-label={name}
          className={rowStyles({ pressable: true })}
          onClick={onPress}
          type="button"
        >
          {face}
        </button>
      )}
      {below && (disclosure === undefined || unfolded) && (
        <div className={belowStyles} id={belowId}>
          {children}
        </div>
      )}
    </li>
  );
};

/** A panel's list of {@link ListRow}s. */
export const List = ({
  children,
  label,
}: {
  children: ReactNode;
  /** Names the list, when no heading over it does. */
  label?: string | undefined;
}) => (
  <ul aria-label={label} className={listStyles}>
    {children}
  </ul>
);

// Filled rows sit apart; plain ones nearly touch, as one list.
const listStyles = flex({
  "&:has(> [data-surface=filled])": { gap: 1 },
  direction: "column",
  gap: 0.5,
  listStyle: "none",
  margin: 0,
  minInlineSize: 0,
  padding: 0,
});

const itemStyles = cva({
  base: {
    borderRadius: "lg",
    display: "flex",
    flexDirection: "column",
    minInlineSize: 0,
  },
  variants: {
    surface: {
      filled: { backgroundColor: "fill" },
      plain: {},
    },
  },
});

// The focus ring is inset, so a scrolling list does not clip it.
const rowStyles = cva({
  base: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "lg",
    borderStyle: "none",
    color: "inherit",
    display: "flex",
    font: "inherit",
    gap: 2.5,
    inlineSize: "100%",
    minBlockSize: 8,
    paddingBlock: 1.5,
    paddingInline: 2,
    textAlign: "start",
  },
  variants: {
    pressable: {
      false: {},
      true: {
        _focusVisible: {
          outline: "{spacing.0.5} solid {colors.accent}",
          outlineOffset: "calc({spacing.0.5} * -1)",
        },
        _hover: { backgroundColor: "fillHover" },
        cursor: "pointer",
        transition: "background-color {durations.fast} {easings.default}",
      },
    },
  },
});

const caretStyles = cva({
  base: { transition: "transform {durations.fast} {easings.default}" },
  variants: {
    unfolded: { false: {}, true: { transform: "rotate(180deg)" } },
  },
});

const iconStyles = css({ display: "inline-flex", flexShrink: 0 });

const textStyles = flex({
  direction: "column",
  flex: 1,
  gap: 0.5,
  minInlineSize: 0,
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

const endStyles = flex({
  align: "center",
  color: "textSoft",
  flexShrink: 0,
  gap: 1,
  textStyle: "panelDetail",
});

// Lined up under the label, past the icon and its gap.
const belowStyles = flex({
  "[data-icon] > &": { paddingInlineStart: 8.5 },
  direction: "column",
  gap: 1.5,
  paddingBlockEnd: 2,
  paddingInline: 2,
});
