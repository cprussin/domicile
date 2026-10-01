// A notification, as a shell draws it and presses it.
//
// Its own module for `tray.ts`'s reason: both halves of the SDK name one —
// `DomicileClient` hands the list on, and the wire schema parses the same
// shape — and a shell's notification center imports it without the client.
//
// A notification is an application's call to `org.freedesktop.Notifications`
// on the session bus, which the compositor serves and a page cannot reach —
// see `crate::notifications` in `domicile-compositor`. A page's own Web
// Notification arrives the same way, because the browser shows one by calling
// that server. What a press does is the application's.

import { z } from "zod";

/**
 * How much a notification asks to be noticed: the spec's `urgency` hint.
 * `critical` is something the user should not miss, and stays up until it is
 * dismissed whatever it asked for.
 */
export const notificationUrgencySchema = z.enum(["low", "normal", "critical"]);

export type NotificationUrgency = z.infer<typeof notificationUrgencySchema>;

/** One button of a notification. */
export type NotificationAction = {
  /** What {@link DomicileClient.invokeNotificationAction} names it by. */
  key: string;
  /** What the button says. */
  label: string;
};

/** One notification. */
export type Notification = {
  /**
   * What {@link DomicileClient.dismissNotifications} and
   * {@link DomicileClient.invokeNotificationAction} name it by. One its
   * application replaced keeps its id and arrives with new contents.
   */
  id: number;
  /** Who sent it, as it named itself. May be empty. */
  appName: string;
  /** The one line that says what happened. */
  summary: string;
  /** More, as plain text — never markup. May be empty. */
  body: string;
  /**
   * The picture, as a `data:` URL: the notification's own image, or its
   * application's icon. `undefined` where there was nothing to draw.
   */
  icon: string | undefined;
  urgency: NotificationUrgency;
  /** Its buttons. A press on the notification itself is {@link clickable}. */
  actions: readonly NotificationAction[];
  /**
   * Whether pressing the notification itself does something: invoke the
   * `"default"` action for that.
   */
  clickable: boolean;
  /**
   * How long it asked to stay up, in milliseconds: `0` for until it is
   * dismissed, `undefined` for the shell's choice.
   */
  timeoutMs: number | undefined;
  /** When it arrived, or was last replaced: milliseconds since the epoch. */
  time: number;
};

/**
 * The action key a press on the notification itself is, where it is
 * {@link Notification.clickable}.
 */
export const DEFAULT_NOTIFICATION_ACTION = "default";
