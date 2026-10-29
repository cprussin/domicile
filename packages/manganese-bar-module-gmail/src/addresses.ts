/** Gmail's origin. */
export const GMAIL_ORIGIN = "https://mail.google.com";

/**
 * The app id of the account's Gmail window. One per account, so each account
 * has its own window and a second open reuses it.
 */
export const gmailAppId = (email: string): string => `gmail:${email}`;

/** The account's inbox in a browser window. */
export const inboxAddress = (email: string): string =>
  `${GMAIL_ORIGIN}/mail/?${asUser(email)}`;

/**
 * Picks the signed-in account by its address. Gmail's `/mail/u/<n>/` takes an
 * account's index, not its address.
 */
const asUser = (email: string): string =>
  new URLSearchParams({ authuser: email }).toString();
