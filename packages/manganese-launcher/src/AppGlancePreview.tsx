import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { hstack, vstack } from "../styled-system/patterns";
import type { AppGlance } from "./app-glance";

/**
 * An app's preview from what the shell knows of it: its picture and name over
 * its account and state, then its newest items, such as an inbox's unread
 * mail. `picture` stands in when the app has no icon.
 */
export const AppGlancePreview = ({
  glance,
  icon,
  name,
  picture,
}: {
  glance: AppGlance;
  icon: string | undefined;
  name: string;
  picture: ReactNode;
}) => (
  <div
    className={glanceStyles}
    data-items={glance.items.length > 0 ? "" : undefined}
  >
    <div className={headerStyles}>
      {icon === undefined ? (
        picture
      ) : (
        <img alt="" className={iconStyles} src={icon} />
      )}
      <span className={namesStyles}>
        <span className={nameStyles}>{name}</span>
        {glance.account !== undefined && (
          <span className={accountStyles}>{glance.account}</span>
        )}
      </span>
      {glance.status !== undefined && (
        <span className={statusStyles}>{glance.status}</span>
      )}
    </div>
    {glance.items.length > 0 && (
      <List label={`Newest in ${name}`}>
        {glance.items.map((item, index) => (
          <ListRow
            detail={item.text}
            end={<span className={atStyles}>{item.at}</span>}
            // Items have no id, and two can match; the order is stable
            // between readings.
            key={index}
            label={item.title}
            surface="filled"
          />
        ))}
      </List>
    )}
  </div>
);

// With no items, the header sits in the middle of the pane.
const glanceStyles = vstack({
  "&:not([data-items])": { blockSize: "100%", justifyContent: "center" },
  alignItems: "stretch",
  gap: 3,
  padding: 4,
});

const headerStyles = hstack({
  gap: 3,
});

const iconStyles = css({
  blockSize: 8,
  flex: "none",
  inlineSize: 8,
  objectFit: "contain",
});

// Name over account, each truncating.
const namesStyles = vstack({
  alignItems: "start",
  flex: "1 1 auto",
  gap: 0,
  minInlineSize: 0,
});

const nameStyles = css({
  color: "foreground",
  fontSize: "md",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const accountStyles = css({
  color: "muted",
  fontSize: "sm",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Tabular figures, so the count doesn't shift as it changes.
const statusStyles = css({
  color: "muted",
  flex: "none",
  fontSize: "sm",
  fontVariantNumeric: "tabular-nums",
});

const atStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
