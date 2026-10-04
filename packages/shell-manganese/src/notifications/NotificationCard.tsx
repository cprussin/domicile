import { Avatar } from "@domicile-desktop/component-library/Avatar";
import { Button } from "@domicile-desktop/component-library/Button";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { DEFAULT_NOTIFICATION_ACTION } from "@domicile-desktop/sdk/notification";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { MouseEvent, ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { grid, hstack } from "../../styled-system/patterns";
import { ago } from "./ago";

type Props = {
  notification: Notification;
  /** The current time, for the relative timestamp. See `useNow`. */
  now: number;
  /**
   * Renders the summary. Toasts wrap it to label the toast for screen readers.
   */
  summary?: ReactNode | undefined;
  /** Renders the body, for the same reason. */
  body?: ReactNode | undefined;
  /** The close button's label: dismissing a toast differs from clearing it. */
  closeLabel: string;
  /**
   * Called when an action is pressed; `"default"` for the card itself. The
   * event lets a toast tell a click from the end of a swipe.
   */
  onAction: (key: string, event: MouseEvent<HTMLElement>) => void;
  onClose: () => void;
};

/**
 * One notification: sender, time, summary, body, actions and a close button.
 * Shared by toasts and the drawer, which each draw their own surface.
 *
 * If the notification has a default action, a press anywhere on the card takes
 * it. The pointer presses the card; the keyboard uses the summary, which is a
 * button for that. Without a default action, only the buttons respond.
 *
 * The close button shows only on hover or focus, to avoid a column of crosses
 * down the drawer.
 */
export const NotificationCard = ({
  body,
  closeLabel,
  notification,
  now,
  onAction,
  onClose,
  summary,
}: Props) => {
  const pressed = (event: MouseEvent<HTMLElement>) => {
    onAction(DEFAULT_NOTIFICATION_ACTION, event);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is not a control and is not being made into one — the press is the pointer's way to the default action, and the summary is the keyboard's
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same press, and the same reason
    // biome-ignore lint/a11y/useKeyWithClickEvents: the summary below is a button for the same press, which is what the keyboard reaches
    <div
      className={cardStyles({ clickable: notification.clickable })}
      data-notification=""
      data-urgency={notification.urgency}
      onClick={notification.clickable ? pressed : undefined}
    >
      {notification.icon === undefined ? (
        <Avatar name={notification.appName || notification.summary} size="xs" />
      ) : (
        <img alt="" className={pictureStyles} src={notification.icon} />
      )}
      <div className={wordsStyles}>
        <div className={senderStyles}>
          {notification.urgency === "critical" && (
            <WarningCircleIcon
              aria-label="Critical"
              className={criticalStyles}
              role="img"
              size={12}
              weight="fill"
            />
          )}
          <span className={appNameStyles}>{notification.appName}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(notification.time).toISOString()}>
            {ago(notification.time, now)}
          </time>
        </div>
        {notification.clickable ? (
          <button
            className={summaryStyles}
            onClick={(event) => {
              // Stop the press from also reaching the card.
              event.stopPropagation();
              pressed(event);
            }}
            type="button"
          >
            {summary ?? notification.summary}
          </button>
        ) : (
          <span className={summaryStyles}>
            {summary ?? notification.summary}
          </span>
        )}
        {notification.body !== "" && (
          <span className={bodyStyles}>{body ?? notification.body}</span>
        )}
        {notification.actions.length > 0 && (
          <div className={actionsStyles}>
            {notification.actions.map(({ key, label }) => (
              <Button
                key={key}
                onClick={(event) => {
                  // Stop the press from also reaching the card.
                  event.stopPropagation();
                  onAction(key, event);
                }}
                rounded
                size="xs"
                variant="outline"
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <button
        aria-label={closeLabel}
        className={closeStyles}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        title={closeLabel}
        type="button"
      >
        <XIcon size={10} weight="bold" />
      </button>
    </div>
  );
};

// The text column, so the summary and body align under the sender, not the
// image.
const cardStyles = cva({
  base: grid.raw({
    alignItems: "start",
    columnGap: 3,
    gridTemplateColumns: "auto minmax(0, 1fr)",
    paddingBlock: 3.5,
    paddingInlineEnd: 9,
    paddingInlineStart: 3.5,
    position: "relative",
    textAlign: "start",
  }),
  variants: {
    clickable: {
      false: {},
      true: { cursor: "pointer" },
    },
  },
});

// An app icon keeps its shape, since most icons are not round; only its corners
// are rounded to match the card.
const pictureStyles = css({
  blockSize: 8,
  borderRadius: "lg",
  flexShrink: 0,
  inlineSize: 8,
  objectFit: "cover",
});

const wordsStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 0.5,
  minInlineSize: 0,
});

const senderStyles = hstack({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  gap: 1,
  lineHeight: "tight",
  minInlineSize: 0,
});

const criticalStyles = css({ color: "danger", flexShrink: 0 });

const appNameStyles = css({
  fontWeight: "medium",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Styled as plain text even when it is a button, since its press is the card's.
const summaryStyles = css({
  _focusVisible: {
    outlineOffset: 0.5,
  },
  all: "unset",
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  lineClamp: 2,
  lineHeight: "snug",
  overflowWrap: "anywhere",
});

// `pre-line` keeps the line breaks senders put in the body.
const bodyStyles = css({
  color: "muted",
  fontSize: "sm",
  lineClamp: 3,
  lineHeight: "snug",
  overflowWrap: "anywhere",
  whiteSpace: "pre-line",
});

const actionsStyles = hstack({
  flexWrap: "wrap",
  gap: 1.5,
  marginBlockStart: 2,
});

const closeStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 18%, transparent)",
    color: "foreground",
  },
  "[data-notification]:hover > &, [data-notification]:focus-within > &": {
    opacity: 1,
    transform: "scale(1)",
  },
  alignItems: "center",
  backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, transparent)",
  blockSize: 5,
  borderRadius: "full",
  borderStyle: "none",
  color: "muted",
  cursor: "pointer",
  display: "inline-flex",
  inlineSize: 5,
  insetBlockStart: 2.5,
  insetInlineEnd: 2.5,
  justifyContent: "center",
  opacity: 0,
  padding: 0,
  position: "absolute",
  transform: "scale(0.8)",
  transition:
    "opacity {durations.fast} {easings.out}, transform {durations.fast} {easings.outBack}, background-color {durations.fast} {easings.default}",
});
