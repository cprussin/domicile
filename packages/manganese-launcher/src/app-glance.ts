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

/** How an app's status reads. */
export enum GlanceTone {
  /** Something waits, such as unread mail; it stands out. */
  Waiting,
  /** Nothing waits; it reads with a check mark. */
  Clear,
  /** Anything else, such as signed out; it reads quietly. */
  Note,
}

/** An app's state in a few words, and how it reads. */
export type GlanceStatus = { text: string; tone: GlanceTone };

/** What an app's preview shows under its name. */
export type AppGlance = {
  /** The account it opens, such as an email address. */
  account: string | undefined;
  /** Its state in a few words, such as `3 unread`; `undefined` while unknown. */
  status: GlanceStatus | undefined;
  /** Its newest items, newest first. */
  items: readonly GlanceItem[];
};
