// What an app's preview tells of it beside its name, such as an inbox's
// unread mail.

/** One of an app's newest items, such as an unread email. */
export type GlanceItem = {
  /** Such as the sender. */
  title: string;
  /** Such as the subject. */
  text: string;
  /** How long ago it came, such as `3h`. */
  at: string;
};

/** What an app's preview shows under its name. */
export type AppGlance = {
  /** The account it opens, such as an email address. */
  account: string | undefined;
  /** Its state in a few words, such as `3 unread`; `undefined` while unknown. */
  status: string | undefined;
  /** Its newest items, newest first. */
  items: readonly GlanceItem[];
};
