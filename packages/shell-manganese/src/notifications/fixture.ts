import type { Notification } from "@domicile/sdk/notification";

/**
 * A notification, for a test: an ordinary one from Firefox at `time` 0, with
 * whatever a case is about laid over it.
 */
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
