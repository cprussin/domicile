export enum InboxKind {
  SignedOut,
  Counted,
}

/** What the bar knows of one account's inbox. Counts are conversations. */
export const Inbox = {
  /** From Gmail's sync: every conversation, and the unread ones. */
  Counted: (total: number, unread: number) => ({
    kind: InboxKind.Counted as const,
    total,
    unread,
  }),
  /** The browser profile is not signed in to the account. */
  SignedOut: () => ({ kind: InboxKind.SignedOut as const }),
};

export type Inbox = ReturnType<(typeof Inbox)[keyof typeof Inbox]>;
