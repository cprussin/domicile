// Waiting: `rest` for a probe with nothing to poll, `settle` for one waiting on
// something that has to cross a socket.
//
// `rest` is shared for the reason `desktop-line.ts` gives: a second copy is a
// chance for one to drift while the scripts around it keep asserting as if it
// had not. Two of the four modules that import this one had a byte-identical
// copy of `rest` before it existed; the two display probes are new, and import
// `settle` rather than `rest`.
//
// `keystroke-driver.ts` and `reload-typist.ts` still spell their own as
// `sleep`. Left alone — this diff has no business in them — so this is
// not yet the whole package.

/** Resolves after `ms` milliseconds. */
export const rest = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/** How often {@link settle} looks again. Short enough not to be the wait. */
const STEP_MS = 25;

/**
 * Resolves once `reached` holds, or after `ms` either way.
 *
 * A deadline rather than a fixed sleep, for a probe waiting on something that
 * has to cross a socket. A sleep long enough on an idle box is a race on a
 * loaded one — the message lands just after it, and the probe reports a chrome
 * that was told nothing when it was told late. Timing out reports whatever it
 * has, so a message that genuinely never comes still fails the script: what
 * the deadline removes is the false alarm, not the real failure.
 */
export const settle = async (
  ms: number,
  reached: () => boolean,
): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!reached() && Date.now() < deadline) {
    await rest(STEP_MS);
  }
};
