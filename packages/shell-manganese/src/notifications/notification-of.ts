import type { DomicileNotification } from "@domicile-desktop/sdk/domicile-host";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { notificationUrgencySchema } from "@domicile-desktop/sdk/notification";

/**
 * A notification as the engine holds it, as this shell draws it: an empty
 * picture read as none, `-1` as a timeout left to the shell, and the urgency
 * parsed — a word with no name here is a compositor this shell does not
 * match, and throws.
 */
export const notificationOf = (item: DomicileNotification): Notification => ({
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
