import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { ListRow } from "@domicile-desktop/component-library/ListRow";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";
import { css } from "../styled-system/css";

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
  <ListRow
    end={
      <>
        {warning && (
          <WarningCircleIcon
            aria-label="Warning"
            className={warningStyles}
            role="img"
            size={14}
            weight="bold"
          />
        )}
        {unread > 0 ? (
          <CountBadge count={unread} inline />
        ) : (
          figure !== undefined && <span className={figureStyles}>{figure}</span>
        )}
      </>
    }
    icon={icon}
    label={name}
    name={label}
    onPress={onOpen}
  />
);

const warningStyles = css({ color: "warning" });

const figureStyles = css({ fontVariantNumeric: "tabular-nums" });
