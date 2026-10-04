import type { Notification } from "@domicile-desktop/sdk/notification";

/** A test notification from Firefox at `time` 0, with `fields` applied. */
export const notification = (fields: Partial<Notification>): Notification => ({
  actions: [],
  appName: "Firefox",
  body: "",
  clickable: false,
  icon: undefined,
  id: 1,
  summary: "New message",
  time: 0,
  timeoutMs: undefined,
  urgency: "normal",
  ...fields,
});
