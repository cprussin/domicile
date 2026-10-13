import type { Inbox } from "./inbox";

/** How often the inbox is read. */
const POLL_MS = 60_000;

/**
 * Reads the inbox now and every {@link POLL_MS}, passing each answer to
 * `onInbox`. Returns what stops it; an answer that arrives after is dropped.
 *
 * - A read is skipped while `paused` says so: a locked desk refuses it.
 * - A failed read goes to `fail`. The last answer stands until the next poll
 *   reads again.
 */
export const watchInbox = (
  read: () => Promise<Inbox>,
  onInbox: (inbox: Inbox) => void,
  paused: () => boolean,
  fail: (error: unknown) => void = logFailure,
): (() => void) => {
  const watch = { stopped: false };
  const poll = () => {
    if (!paused()) {
      read().then((inbox) => {
        if (!watch.stopped) {
          onInbox(inbox);
        }
      }, fail);
    }
  };
  poll();
  const timer = setInterval(poll, POLL_MS);
  return () => {
    watch.stopped = true;
    clearInterval(timer);
  };
};

const logFailure = (error: unknown) => {
  // biome-ignore lint/suspicious/noConsole: the bar keeps the last count, and this says why
  console.error("manganese: could not read the Gmail inbox", error);
};
