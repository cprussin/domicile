export enum InboxKind {
  SignedOut,
  Counted,
  Unread,
}

/** What the bar knows of one account's inbox. Counts are conversations. */
export const Inbox = {
  /** From the Gmail API: every conversation, and the unread ones. */
  Counted: (total: number, unread: number) => ({
    kind: InboxKind.Counted as const,
    total,
    unread,
  }),
  /** The browser profile is not signed in to the account. */
  SignedOut: () => ({ kind: InboxKind.SignedOut as const }),
  /** From the Atom feed when the Gmail API fails: the unread count alone. */
  Unread: (unread: number) => ({ kind: InboxKind.Unread as const, unread }),
};

export type Inbox = ReturnType<(typeof Inbox)[keyof typeof Inbox]>;
