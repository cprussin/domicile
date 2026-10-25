// The desk's notifications, which the compositor serves as
// `org.freedesktop.Notifications`. See docs/architecture/NOTIFICATIONS.md.

import type { DomicileHost, DomicileNotification } from "../domicile-host";
import type { Notification } from "../notification";
import { notificationUrgencySchema } from "../notification";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type NotificationsListeners = {
  change: () => void;
};

export type Notifications = {
  /**
   * Every uncleared notification, oldest first; `undefined` until the
   * compositor says. Throws on an urgency the spec does not have.
   */
  readonly list: readonly Notification[] | undefined;
  /** Clear `ids`; each application hears it was dismissed. */
  dismiss: (ids: readonly number[]) => void;
  /** Press `action` on `id`: `"default"` for the notification itself. */
  invoke: (id: number, action: string) => void;
  /** Send `text` from `id`'s reply field. */
  reply: (id: number, text: string) => void;
  on: On<NotificationsListeners>;
};

export type NotificationsHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "dismissNotifications"
  | "invokeNotificationAction"
  | "notifications"
  | "removeEventListener"
  | "replyToNotification"
>;

export const notifications = (host: NotificationsHost): Notifications => {
  const listOf = memoizeLast((list: readonly DomicileNotification[] | null) =>
    list?.map(notificationOf),
  );
  return {
    dismiss: (ids) => {
      host.dismissNotifications(ids);
    },
    invoke: (id, action) => {
      host.invokeNotificationAction(id, action);
    },
    get list() {
      return listOf(host.notifications);
    },
    on: on<NotificationsListeners>({
      change: (listener) =>
        hostEvent(host, "notificationschanged", () => listener()),
    }),
    reply: (id, text) => {
      host.replyToNotification(id, text);
    },
  };
};

/** The engine sends `""` for no icon and a negative timeout for none asked. */
const notificationOf = (item: DomicileNotification): Notification => ({
  actions: item.actions.map(({ key, label }) => ({ key, label })),
  appName: item.appName,
  body: item.body,
  clickable: item.clickable,
  icon: item.icon === "" ? undefined : item.icon,
  id: item.id,
  summary: item.summary,
  time: item.time,
  timeoutMs: item.timeoutMs < 0 ? undefined : item.timeoutMs,
  urgency: notificationUrgencySchema.parse(item.urgency),
});
