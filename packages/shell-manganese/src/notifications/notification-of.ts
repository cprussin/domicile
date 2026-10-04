import type { DomicileNotification } from "@domicile-desktop/sdk/domicile-host";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { notificationUrgencySchema } from "@domicile-desktop/sdk/notification";

/**
 * Converts the engine's notification to this shell's: an empty picture is
 * none, a `-1` timeout is left to the shell, and the urgency is parsed (an
 * unknown one throws).
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
