import { Inbox } from "./inbox";

/** How often the inbox is read. */
const POLL_MS = 60_000;

/** A running watch. */
export type InboxWatch = {
  /** Answers `reading` as a poll's, such as a read just after signing in. */
  answer: (reading: Promise<Inbox>) => void;
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
  const watch = { stopped: false };
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
  poll();
  const timer = setInterval(poll, POLL_MS);
  return {
    answer,
    stop: () => {
      watch.stopped = true;
      clearInterval(timer);
    },
  };
};
