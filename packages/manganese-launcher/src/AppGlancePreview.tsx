import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { ChecksIcon } from "@phosphor-icons/react/dist/ssr/Checks";
import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { hstack, vstack } from "../styled-system/patterns";
import type { AppGlance } from "./app-glance";
import { GlanceTone } from "./app-glance";

/** The app's picture, as large as other previews' glyphs. */
const PICTURE_SIZE = 16;

/**
 * An app's preview from what the shell knows of it: its picture, name and
 * account, then its newest items, such as an inbox's unread mail, or what its
 * state is when it has none. Centered in the pane at any height.
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
  <div className={paneStyles}>
    <div className={contentStyles}>
      <div className={heroStyles}>
        {icon === undefined ? (
          picture
        ) : (
          <img alt="" className={iconStyles} src={icon} />
        )}
        <span className={nameStyles}>{name}</span>
        {glance.account !== undefined && (
          <span className={accountStyles}>{glance.account}</span>
        )}
        {glance.status !== undefined && (
          <span
            className={statusStyles}
            data-waiting={
              glance.status.tone === GlanceTone.Waiting ? "" : undefined
            }
          >
            {glance.status.tone === GlanceTone.Clear && (
              <ChecksIcon aria-hidden size={16} />
            )}
            {glance.status.text}
          </span>
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
  </div>
);

// At least the pane's height, so it centers in it; taller, the pane scrolls.
const paneStyles = vstack({
  justifyContent: "safe center",
  minBlockSize: "100%",
  padding: 6,
});

const contentStyles = vstack({
  alignItems: "stretch",
  gap: 6,
  inlineSize: "100%",
  maxInlineSize: "32rem",
});

const heroStyles = vstack({
  gap: 1,
  textAlign: "center",
});

const iconStyles = css({
  blockSize: PICTURE_SIZE,
  inlineSize: PICTURE_SIZE,
  marginBlockEnd: 2,
  objectFit: "contain",
});

const nameStyles = css({
  color: "foreground",
  fontSize: "lg",
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

// A count waiting to be read stands out; anything else is quiet.
const statusStyles = hstack({
  "&[data-waiting]": { backgroundColor: "fill", color: "foreground" },
  borderRadius: "full",
  color: "muted",
  fontSize: "sm",
  fontVariantNumeric: "tabular-nums",
  gap: 1.5,
  marginBlockStart: 3,
  paddingBlock: 1,
  paddingInline: 3,
});

const atStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
