import { Avatar } from "@domicile-desktop/component-library/Avatar";
import { Button } from "@domicile-desktop/component-library/Button";
import type { Notification } from "@domicile-desktop/sdk/notification";
import {
  DEFAULT_NOTIFICATION_ACTION,
  INLINE_REPLY_NOTIFICATION_ACTION,
} from "@domicile-desktop/sdk/notification";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { MouseEvent, ReactNode } from "react";

import { css, cva } from "../styled-system/css";
import { grid, hstack } from "../styled-system/patterns";
import { ago } from "./ago";
import { NotificationReply } from "./NotificationReply";

/** `roomy` for a toast on its own; `compact` for one of a list. */
export type Density = "roomy" | "compact";

type Props = {
  density?: Density | undefined;
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
  /** Called with what is typed in the reply field. */
  onReply: (text: string) => void;
};

/**
 * One notification: sender, time, summary, body, actions, a reply field if it
 * offers one, and a close button.
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
  density = "roomy",
  notification,
  now,
  onAction,
  onClose,
  onReply,
  summary,
}: Props) => {
  const pressed = (event: MouseEvent<HTMLElement>) => {
    onAction(DEFAULT_NOTIFICATION_ACTION, event);
  };
  const reply = notification.actions.find(
    ({ key }) => key === INLINE_REPLY_NOTIFICATION_ACTION,
  );
  const buttons = notification.actions.filter(
    ({ key }) => key !== INLINE_REPLY_NOTIFICATION_ACTION,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is not a control and is not being made into one — the press is the pointer's way to the default action, and the summary is the keyboard's
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same press, and the same reason
    // biome-ignore lint/a11y/useKeyWithClickEvents: the summary below is a button for the same press, which is what the keyboard reaches
    <div
      className={cardStyles({ clickable: notification.clickable, density })}
      data-density={density}
      data-notification=""
      data-urgency={notification.urgency}
      onClick={notification.clickable ? pressed : undefined}
    >
      {notification.icon === undefined ? (
        <Avatar
          name={notification.appName || notification.summary}
          size={density === "compact" ? "2xs" : "xs"}
        />
      ) : (
        <img
          alt=""
          className={pictureStyles({ density })}
          src={notification.icon}
        />
      )}
      <div className={wordsStyles}>
        <div className={senderStyles({ density })}>
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
            className={summaryStyles({ density })}
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
          <span className={summaryStyles({ density })}>
            {summary ?? notification.summary}
          </span>
        )}
        {notification.body !== "" && (
          <span className={bodyStyles({ density })}>
            {body ?? notification.body}
          </span>
        )}
        {buttons.length > 0 && (
          <div className={actionsStyles}>
            {buttons.map(({ key, label }) => (
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
        {reply !== undefined && (
          <NotificationReply label={reply.label} onReply={onReply} />
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
    gridTemplateColumns: "auto minmax(0, 1fr)",
    position: "relative",
    textAlign: "start",
  }),
  variants: {
    clickable: {
      false: {},
      true: { cursor: "pointer" },
    },
    // Compact uses the panel type, as a list's rows do.
    density: {
      compact: {
        columnGap: 2.5,
        paddingBlock: 2,
        paddingInlineEnd: 8,
        paddingInlineStart: 2.5,
      },
      roomy: {
        columnGap: 3,
        paddingBlock: 3.5,
        paddingInlineEnd: 9,
        paddingInlineStart: 3.5,
      },
    },
  },
});

// An app icon keeps its shape, since most icons are not round; only its corners
// are rounded to match the card.
const pictureStyles = cva({
  base: { borderRadius: "lg", flexShrink: 0, objectFit: "cover" },
  variants: {
    density: {
      compact: { blockSize: 6, inlineSize: 6 },
      roomy: { blockSize: 8, inlineSize: 8 },
    },
  },
});

const wordsStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 0.5,
  minInlineSize: 0,
});

const senderStyles = cva({
  base: hstack.raw({
    fontSize: "xs",
    fontVariantNumeric: "tabular-nums",
    gap: 1,
    lineHeight: "tight",
    minInlineSize: 0,
  }),
  variants: {
    density: {
      compact: { color: "textFaint" },
      roomy: { color: "muted" },
    },
  },
});

const criticalStyles = css({ color: "danger", flexShrink: 0 });

const appNameStyles = css({
  fontWeight: "medium",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Styled as plain text even when it is a button, since its press is the card's.
const summaryStyles = cva({
  base: {
    _focusVisible: {
      outlineOffset: 0.5,
    },
    all: "unset",
    color: "foreground",
    lineClamp: 2,
    overflowWrap: "anywhere",
  },
  variants: {
    density: {
      compact: { textStyle: "panelLabel" },
      roomy: { fontSize: "sm", fontWeight: "semibold", lineHeight: "snug" },
    },
  },
});

// `pre-line` keeps the line breaks senders put in the body.
const bodyStyles = cva({
  base: { overflowWrap: "anywhere", whiteSpace: "pre-line" },
  variants: {
    density: {
      compact: { color: "textSoft", lineClamp: 2, textStyle: "panelDetail" },
      roomy: {
        color: "muted",
        fontSize: "sm",
        lineClamp: 3,
        lineHeight: "snug",
      },
    },
  },
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
