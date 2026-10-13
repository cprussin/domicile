/** Gmail's origin, which its first-party API calls come from. */
export const GMAIL_ORIGIN = "https://mail.google.com";

/** The account's inbox in a browser window. */
export const inboxAddress = (email: string): string =>
  `${GMAIL_ORIGIN}/mail/u/${email}/`;

/** The account's unread inbox conversations as an Atom feed. */
export const feedAddress = (email: string): string =>
  `${inboxAddress(email)}feed/atom`;

/** Google's sign-in for the account, which then opens its inbox. */
export const signInAddress = (email: string): string =>
  `https://accounts.google.com/AccountChooser?${new URLSearchParams({
    continue: inboxAddress(email),
    Email: email,
  }).toString()}`;
