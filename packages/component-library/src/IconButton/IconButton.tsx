import { Button as BaseButton } from "@base-ui/react/button";
import type { ReactNode } from "react";

import { cva } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";

export const SIZES = ["sm", "md"] as const;
export type Size = (typeof SIZES)[number];

type Props = ExtendProps<
  typeof BaseButton,
  {
    /** The icon, sized to suit: 14 for `md`, 12 for `sm`. */
    children: ReactNode;
    /** Names the button, which shows only its icon. */
    label: string;
    size?: Size | undefined;
  }
>;

/**
 * A round, quiet button that shows only an icon: a panel's back arrow, a
 * row's details arrow, a mute button. A circle lights under the pointer.
 *
 * Drawn in `currentcolor`, so it reads on a card, over the wallpaper and on
 * an accent tile.
 */
export const IconButton = ({
  children,
  label,
  size = "md",
  ...buttonProps
}: Props) => (
  <BaseButton
    aria-label={label}
    className={styles({ size })}
    data-size={size}
    {...buttonProps}
  >
    {children}
  </BaseButton>
);

const styles = cva({
  base: {
    _disabled: { cursor: "default", opacity: "disabled" },
    _focusVisible: {
      outline: "{spacing.0.5} solid {colors.accent}",
      outlineOffset: 0,
    },
    _hoverEnabled: { backgroundColor: "fillHover" },
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "full",
    borderStyle: "none",
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    padding: 0,
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    size: {
      md: { blockSize: 6, inlineSize: 6 },
      sm: { blockSize: 5, inlineSize: 5 },
    },
  },
});
