import { Inbox } from "./inbox";

/** How often the inbox is read. */
const POLL_MS = 60_000;

/**
 * Reads the inbox now and every {@link POLL_MS}, passing each answer to
 * `onInbox`. Returns what stops it; an answer that arrives after is dropped.
 *
 * - A read is skipped while `paused` says so: a locked desk refuses it.
 * - A failed read is an {@link Inbox.Failed} answer, naming why.
 */
export const watchInbox = (
  read: () => Promise<Inbox>,
  onInbox: (inbox: Inbox) => void,
  paused: () => boolean,
): (() => void) => {
  const watch = { stopped: false };
  const answer = (inbox: Inbox) => {
    if (!watch.stopped) {
      onInbox(inbox);
    }
  };
  const poll = () => {
    if (!paused()) {
      read().then(answer, (error: unknown) => {
        answer(Inbox.Failed(String(error)));
      });
    }
  };
  poll();
  const timer = setInterval(poll, POLL_MS);
  return () => {
    watch.stopped = true;
    clearInterval(timer);
  };
};
