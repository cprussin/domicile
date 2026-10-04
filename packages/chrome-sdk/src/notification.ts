// Notification types for a shell's notification center.
//
// The compositor serves `org.freedesktop.Notifications` (see
// `crate::notifications` in `domicile-compositor`); web notifications arrive
// the same way. See `docs/architecture/NOTIFICATIONS.md`.

import { z } from "zod";

/**
 * The spec's `urgency` hint. A `critical` notification stays up until
 * dismissed, whatever its timeout.
 */
export const notificationUrgencySchema = z.enum(["low", "normal", "critical"]);

export type NotificationUrgency = z.infer<typeof notificationUrgencySchema>;

/** One button of a notification. */
export type NotificationAction = {
  /** The key for {@link DomicileClient.invokeNotificationAction}. */
  key: string;
  /** The button text. */
  label: string;
};

/** One notification. */
export type Notification = {
  /**
   * The id for {@link DomicileClient.dismissNotifications} and
   * {@link DomicileClient.invokeNotificationAction}. A replaced notification
   * keeps its id.
   */
  id: number;
  /** The sender's self-reported name. May be empty. */
  appName: string;
  /** A one-line summary. */
  summary: string;
  /** Plain text, never markup. May be empty. */
  body: string;
  /**
   * The notification's image or its app's icon, as a `data:` URL, or
   * `undefined` if neither exists.
   */
  icon: string | undefined;
  urgency: NotificationUrgency;
  /** Its buttons. See {@link clickable} for a press on the body. */
  actions: readonly NotificationAction[];
  /** Whether pressing the body invokes the `"default"` action. */
  clickable: boolean;
  /**
   * Requested display time in milliseconds: `0` means until dismissed,
   * `undefined` means the shell decides.
   */
  timeoutMs: number | undefined;
  /** When it arrived or was last replaced, in milliseconds since the epoch. */
  time: number;
};

/** The action key for a press on a {@link Notification.clickable} body. */
export const DEFAULT_NOTIFICATION_ACTION = "default";
