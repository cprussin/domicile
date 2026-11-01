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
  title: ReactNode;
};

/**
 * A panel's title, with a back button when it is one level in, and its
 * controls at the end. The title is a level-2 heading; a `PanelSection`'s is
 * level 3.
 */
export const PanelHeader = ({ action, onBack, title, titleId }: Props) => (
  <div className={headerStyles}>
    {onBack !== undefined && (
      <IconButton label="Back" onClick={onBack}>
        <CaretLeftIcon aria-hidden size={14} weight="bold" />
      </IconButton>
    )}
    <h2 className={titleStyles} id={titleId}>
      {title}
    </h2>
    {action !== undefined && <span className={actionStyles}>{action}</span>}
  </div>
);

const headerStyles = hstack({ gap: 1, minBlockSize: 7 });

const titleStyles = css({
  flex: 1,
  margin: 0,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  textStyle: "panelTitle",
  whiteSpace: "nowrap",
});

const actionStyles = hstack({ flexShrink: 0, gap: 1 });
