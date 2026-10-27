import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

type Props = {
  /** A short figure at the row's end, such as the conversation count. */
  figure?: string | undefined;
  icon: ReactNode;
  /** The row's name for assistive tech, with its counts in words. */
  label: string;
  /** The inbox's name, such as `Work`. */
  name: string;
  onOpen: () => void;
  /** How many conversations are unread, in a pill in place of the figure. */
  unread: number;
  /** Marks an inbox that could not be read. */
  warning?: boolean | undefined;
};

/**
 * One inbox in the notification drawer's list: its icon, its name, and the
 * unread count, or a figure while nothing is unread. A press opens it.
 */
export const InboxRow = ({
  figure,
  icon,
  label,
  name,
  onOpen,
  unread,
  warning = false,
}: Props) => (
  <li className={itemStyles}>
    <button
      aria-label={label}
      className={rowStyles}
      onClick={onOpen}
      type="button"
    >
      <span className={iconStyles}>{icon}</span>
      <span className={nameStyles} data-unread={unread > 0 ? "" : undefined}>
        {name}
      </span>
      {warning && (
        <WarningCircleIcon
          aria-label="Warning"
          className={warningStyles}
          role="img"
          size={16}
          weight="bold"
        />
      )}
      {unread > 0 ? (
        <CountBadge count={unread} inline />
      ) : (
        figure !== undefined && <span className={figureStyles}>{figure}</span>
      )}
    </button>
  </li>
);

const itemStyles = css({ listStyle: "none" });

// Lit on hover, as the drawer's notification cards.
// The focus ring is inset, so the scrolling list does not clip it.
const rowStyles = hstack({
  _focusVisible: {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: "calc({spacing.0.5} * -1)",
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 7%, transparent)",
  },
  backgroundColor: "transparent",
  borderRadius: "md",
  borderStyle: "none",
  color: "foreground",
  cursor: "pointer",
  font: "inherit",
  fontSize: "sm",
  gap: 2.5,
  inlineSize: "full",
  paddingBlock: 1,
  paddingInline: 1.5,
  textAlign: "start",
  transition: "background-color {durations.fast} {easings.default}",
});

const iconStyles = css({ display: "inline-flex", flexShrink: 0 });

const nameStyles = css({
  "&[data-unread]": { fontWeight: "semibold" },
  flex: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const warningStyles = css({ color: "warning", flexShrink: 0 });

const figureStyles = css({
  color: "muted",
  flexShrink: 0,
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
