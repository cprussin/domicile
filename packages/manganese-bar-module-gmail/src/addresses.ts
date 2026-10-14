/** Gmail's origin, which its first-party API calls come from. */
export const GMAIL_ORIGIN = "https://mail.google.com";

/** The account's inbox in a browser window. */
export const inboxAddress = (email: string): string =>
  `${GMAIL_ORIGIN}/mail/?${asUser(email)}`;

/** The account's unread inbox conversations as an Atom feed. */
export const feedAddress = (email: string): string =>
  `${GMAIL_ORIGIN}/mail/feed/atom?${asUser(email)}`;

/** Google's sign-in for the account, which then opens its inbox. */
export const signInAddress = (email: string): string =>
  `https://accounts.google.com/AccountChooser?${new URLSearchParams({
    continue: inboxAddress(email),
    Email: email,
  }).toString()}`;

/**
 * Picks the signed-in account by its address. Gmail's `/mail/u/<n>/` takes an
 * account's index, not its address.
 */
const asUser = (email: string): string =>
  new URLSearchParams({ authuser: email }).toString();
