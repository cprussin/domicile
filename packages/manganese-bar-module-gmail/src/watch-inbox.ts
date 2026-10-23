import { Inbox } from "./inbox";

/** How often the inbox is read. */
const POLL_MS = 30_000;

/**
 * When a nudged inbox is read, after the last nudge. Gmail marks a message
 * read a moment after it opens, so a read at once can miss it.
 */
const SOON_MS = [1000, 5000];

/** A running watch. */
export type InboxWatch = {
  /** Answers `reading` as a poll's, such as a read just after signing in. */
  answer: (reading: Promise<Inbox>) => void;
  /**
   * Reads at each of {@link SOON_MS}, for an inbox that has likely changed.
   * Each call restarts them.
   */
  readSoon: () => void;
  /** Stops the watch; an answer that arrives after is dropped. */
  stop: () => void;
};

/**
 * Reads the inbox now and every {@link POLL_MS}, passing each answer to
 * `onInbox`.
 *
 * - A read is skipped while `paused` says so: a locked desk refuses it.
 * - A failed read is an {@link Inbox.Failed} answer, naming why.
 */
export const watchInbox = (
  read: () => Promise<Inbox>,
  onInbox: (inbox: Inbox) => void,
  paused: () => boolean,
): InboxWatch => {
  const watch: {
    stopped: boolean;
    soon: readonly ReturnType<typeof setTimeout>[];
  } = {
    soon: [],
    stopped: false,
  };
  const answer = (reading: Promise<Inbox>) => {
    reading.then(
      (inbox) => {
        if (!watch.stopped) {
          onInbox(inbox);
        }
      },
      (error: unknown) => {
        if (!watch.stopped) {
          onInbox(Inbox.Failed(String(error)));
        }
      },
    );
  };
  const poll = () => {
    if (!paused()) {
      answer(read());
    }
  };
  const clearSoon = () => {
    for (const timer of watch.soon) {
      clearTimeout(timer);
    }
  };
  poll();
  const timer = setInterval(poll, POLL_MS);
  return {
    answer,
    readSoon: () => {
      clearSoon();
      watch.soon = SOON_MS.map((ms) => setTimeout(poll, ms));
    },
    stop: () => {
      watch.stopped = true;
      clearInterval(timer);
      clearSoon();
    },
  };
};
