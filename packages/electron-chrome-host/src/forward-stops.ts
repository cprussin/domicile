// Passing a stop on to whatever the launcher is currently running.
//
// Installing a handler for a signal takes away Node's default, which is to
// terminate — so a launcher that forwards INT, TERM and HUP and nothing else
// becomes a process none of them can stop. That is worse than not handling
// them: the only way out is a SIGKILL on the launcher, which skips every
// `finally` and orphans exactly the children the forwarding existed to take
// down. So a forwarded stop is always armed with an end.

import { STOP_SIGNALS } from "./stop-signals";

/** Whatever the launcher is running, as stopping it needs to see it. */
export type StopTarget = {
  /** Pass the stop on. Nothing running yet is a case this must handle. */
  signal: (signal: NodeJS.Signals) => void;
  /** End it, for a target that did not take the signal. */
  end: () => void;
};

/** Where the signals come from. `process`, outside a test. */
export type SignalSource = {
  on: (signal: NodeJS.Signals, listener: () => void) => void;
  off: (signal: NodeJS.Signals, listener: () => void) => void;
};

/** How the wait between the stop and the end is measured. */
export type Grace = (end: () => void) => () => void;

/**
 * Forward every stop signal to `target`, and end it if it does not go.
 *
 * Returns the release: it removes the handlers and cancels anything still
 * armed, and must be called once the target is gone — otherwise the launcher
 * keeps a timer that will fire at a process that has already exited.
 */
export const forwardStops = (
  target: StopTarget,
  grace: Grace = defaultGrace,
  source: SignalSource = process,
): (() => void) => {
  const armed = new Set<() => void>();
  const listeners = STOP_SIGNALS.map((signal) => {
    const forward = (): void => {
      target.signal(signal);
      // The handle is captured through a box rather than closed over
      // directly: a `Grace` that called `end` synchronously would otherwise
      // reach `cancel` before its binding existed, which is a `ReferenceError`
      // rather than a missed delete.
      const armedHere: { cancel?: () => void } = {};
      armedHere.cancel = grace(() => {
        if (armedHere.cancel !== undefined) {
          armed.delete(armedHere.cancel);
        }
        target.end();
      });
      armed.add(armedHere.cancel);
    };
    source.on(signal, forward);
    return { forward, signal };
  });

  return () => {
    for (const { forward, signal } of listeners) {
      source.off(signal, forward);
    }
    for (const cancel of armed) {
      cancel();
    }
    armed.clear();
  };
};

/**
 * How long a target gets to go down on its own.
 *
 * Unreferenced, so a launcher whose desktop closed cleanly is not held open by
 * a timer waiting to kill something that already went.
 */
const defaultGrace: Grace = (end) => {
  const timer = setTimeout(end, 2000);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};
