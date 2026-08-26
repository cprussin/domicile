// Waiting: `rest`, for a probe with nothing to poll.
//
// Shared for the reason `desktop-line.ts` gives: a second copy is a chance for
// one to drift while the scripts around it keep asserting as if it had not.
// Two of the modules importing this one had a byte-identical copy of `rest`
// before it existed.
//
// `keystroke-driver.ts` and `reload-typist.ts` still spell their own as
// `sleep`. Left alone — this diff has no business in them — so this is
// not yet the whole package.

/** Resolves after `ms` milliseconds. */
export const rest = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));
