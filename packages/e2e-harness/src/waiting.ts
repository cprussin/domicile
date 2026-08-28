// Waiting: `rest`, for a probe with nothing to poll.
//
// Shared because a second copy is a chance for one to drift while the scripts
// around it keep asserting as if it had not. Two of the modules importing this
// one had a byte-identical copy of `rest` before it existed.
//
// `keystroke-driver.ts` still spells its own as `sleep`. Left alone — this
// diff has no business in it — so this is not yet the whole package.

/** Resolves after `ms` milliseconds. */
export const rest = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));
