import type { DomicileNotification } from "@domicile-desktop/sdk/domicile-host";

/** The site Messages' notifications come from, as the engine names it. */
export const MESSAGES_SITE = "messages.google.com";

/** The ids of Messages' notifications among `items`. */
export const messagesFrom = (
  items: readonly DomicileNotification[],
): readonly number[] =>
  items.filter(({ appName }) => appName === MESSAGES_SITE).map(({ id }) => id);
