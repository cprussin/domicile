import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { IconButton } from "../IconButton/IconButton";
import "../stylesheet";

type Props = {
  /** Controls at the header's end, such as a switch. */
  action?: ReactNode | undefined;
  /** Gives the title an id, to name the panel by. */
  titleId?: string | undefined;
  /** Shows a back button that calls it. */
  onBack?: (() => void) | undefined;
  /** A state the panel is in, such as paused, on a line under the title. */
  status?: ReactNode | undefined;
  title: ReactNode;
};

/**
 * A panel's title, with a back button when it is one level in, and its
 * controls at the end. The title is a level-2 heading; a `PanelSection`'s is
 * level 3. A status sits under the title, outside the heading, so it does not
 * rename the panel.
 */
export const PanelHeader = ({
  action,
  onBack,
  status,
  title,
  titleId,
}: Props) => (
  <div className={headerStyles}>
    {onBack !== undefined && (
      <IconButton label="Back" onClick={onBack}>
        <CaretLeftIcon aria-hidden size={14} weight="bold" />
      </IconButton>
    )}
    <div className={titlesStyles}>
      <h2 className={titleStyles} id={titleId}>
        {title}
      </h2>
      {status !== undefined && <p className={statusStyles}>{status}</p>}
    </div>
    {action !== undefined && <span className={actionStyles}>{action}</span>}
  </div>
);

const headerStyles = hstack({ gap: 1, minBlockSize: 7 });

const titlesStyles = css({ flex: 1, minInlineSize: 0 });

const titleStyles = css({
  margin: 0,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelTitle",
  whiteSpace: "nowrap",
});

// In the accent, as a lit tile is: a state the user put the panel in.
const statusStyles = css({
  color: "accent",
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelDetail",
  whiteSpace: "nowrap",
});

const actionStyles = hstack({ flexShrink: 0, gap: 1 });
