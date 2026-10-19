export enum InboxKind {
  SignedOut,
  Counted,
  Failed,
}

/** What the bar knows of one account's inbox. Counts are conversations. */
export const Inbox = {
  /** Every conversation, and the unread ones. */
  Counted: (total: number, unread: number) => ({
    kind: InboxKind.Counted as const,
    total,
    unread,
  }),
  /** The read failed, for `reason`. */
  Failed: (reason: string) => ({ kind: InboxKind.Failed as const, reason }),
  /** The account has not signed in, or Google revoked its sign-in. */
  SignedOut: () => ({ kind: InboxKind.SignedOut as const }),
};

export type Inbox = ReturnType<(typeof Inbox)[keyof typeof Inbox]>;
