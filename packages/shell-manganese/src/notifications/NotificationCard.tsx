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
  /** The time now, for how long ago it arrived. See `useNow`. */
  now: number;
  /**
   * What the summary is drawn as: its text, unless the card is on a toast,
   * which wraps it in the part that names the toast to a screen reader.
   */
  summary?: ReactNode | undefined;
  /** And the body, for the same reason. */
  body?: ReactNode | undefined;
  /** What the close button is called: dismissing a toast is not clearing one. */
  closeLabel: string;
  /**
   * One of its actions was pressed — `"default"` for the card itself. The
   * event is the press's, so a toast can tell a click from the end of a
   * swipe.
   */
  onAction: (key: string, event: MouseEvent<HTMLElement>) => void;
  onClose: () => void;
};

/**
 * What one notification says: who sent it and when, its summary and body, its
 * buttons, and a way to put it away — the same card on a toast and in the
 * drawer, which each draw their own surface under it.
 *
 * **A press anywhere on a card that offers its default action takes it**, which
 * is what a press on a notification does on every desktop. The pointer's
 * press is the card's; the keyboard's is the summary, which is a button for
 * exactly that. A card that offers no default has nothing to press but its
 * buttons, and draws no cursor saying otherwise.
 *
 * The close button waits until the pointer is over the card or the keyboard is
 * in it: on every card at once it is a column of crosses down the drawer.
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
              // The card's press, once: not the card's again on the way up.
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
                  // Its own press and not the card's as well.
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

// The picture beside the words, and the words: a column of its own, so the
// summary and the body line up under the sender rather than under the picture.
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

// An application's own picture is not cut into a circle — it is its icon, and
// most icons are not round — but its corners are softened to sit with the
// card's.
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

// Plain text, button or not: the press it stands for is the card's, and a
// summary drawn as a button would be a card with a button on it.
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

// `pre-line`, because a sender breaks its body into lines — the browser puts
// a page's words a line under its own — and collapsing them runs two thoughts
// together.
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
