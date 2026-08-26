// Waiting for the compositor to say it is up.
//
// There is no signal to wait on: the compositor publishes a file and the shell
// watches for it. What makes that safe is that the publish is a rename, so the
// document is either absent or whole — and what makes it terminate is that the
// same wait is watching the process, which is the only other thing that can
// happen.

import type { CompositorSession } from "./compositor-session";
import { parseSession } from "./compositor-session";

/** Everything the wait does to the world, so a test can do none of it. */
export type SessionWait = {
  /** The published document, or `undefined` while it is not there yet. */
  read: () => Promise<string | undefined>;
  /** Resolves with a reason when there is no longer any point waiting. */
  failed: Promise<string>;
  /** How long to leave between looks. */
  delay: () => Promise<void>;
};

/**
 * Wait for the compositor to publish its session.
 *
 * Throws if it stops first, carrying the reason: a shell that waited forever
 * would show the user nothing at all, when the compositor has usually already
 * said on stderr exactly what was wrong.
 */
export const awaitSession = async (
  wait: SessionWait,
): Promise<CompositorSession> => {
  const text = await wait.read();
  // How much longer there is any point waiting, raced against there being no
  // point at all: another look away when there was nothing to read, and no
  // time at all when there was. A document in hand is not a reason to skip
  // this. A compositor that published and then died is *not* a session — the
  // document describes sockets nothing is serving any more — and neither is
  // one published by a run the caller has already asked to stop.
  //
  // `failed` goes first because `Promise.race` settles on the earliest
  // *already-settled* argument in order, so a decision that was taken before
  // the read finished beats a document that happened to be on disk by then.
  // Asking it this way rather than awaiting it is what keeps the ordinary
  // path — where nothing ever goes wrong and `failed` never settles — from
  // waiting on a promise that will never answer.
  const why = await Promise.race([
    wait.failed,
    text === undefined
      ? wait.delay().then(() => undefined)
      : Promise.resolve(undefined),
  ]);
  if (why !== undefined) {
    throw new Error(
      `domicile: the compositor never published a session — ${why}`,
    );
  } else if (text === undefined) {
    return awaitSession(wait);
  } else {
    return parseSession(text);
  }
};
