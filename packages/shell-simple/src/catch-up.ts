// When the desktop stops catching up and starts running.
//
// Every chrome that connects is replayed every window already running — as if
// each had just appeared — and told at the end of that who actually holds the
// keyboard. The two are indistinguishable from the messages alone: a replayed
// `app_appeared` and a brand new one are the same message. What separates them
// is the `focus_changed` the replay ends with, which arrives whether or not
// anything is running and so is a signal that is always there.
//
// This is one line of wiring, in a module of its own because it is the line
// that decides whether reloading the desktop moves the user's keyboard.

/** As much of the bridge as noticing the end of the catch-up needs. */
export type CatchUpBridge = {
  on: (type: "focus_changed", listener: () => void) => unknown;
};

/** As much of the desktop as it needs. */
export type CatchUpDesktop = {
  caughtUp: () => void;
};

/**
 * Tell the desktop when the host has finished describing what was already
 * there, so the next window to appear is one someone opened.
 *
 * What the message *says* is not read: this shell draws nothing to show which
 * window has the keyboard, and the SDK's own idea of that is written by the
 * click or the open that moved it. Only its arrival is the news.
 */
export const endCatchUpOnFocusChange = (
  bridge: CatchUpBridge,
  desktop: CatchUpDesktop,
): void => {
  bridge.on("focus_changed", () => {
    desktop.caughtUp();
  });
};
