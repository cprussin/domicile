import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { Release } from "./portal-inhibit";

/** Where the bar's idle inhibitor is. */
export enum Inhibiting {
  Off,
  /** Asked for; the portal has not answered. */
  Taking,
  On,
  /** Letting go; the portal has not answered. */
  Releasing,
}

/** The bar's idle inhibitor, for `useSyncExternalStore`. */
export type IdleInhibitor = {
  subscribe: (onChange: () => void) => () => void;
  current: () => Inhibiting;
  /**
   * Holds the inhibitor when off and lets go when on. Throws while the portal
   * has not answered the last toggle.
   */
  toggle: () => void;
};

/** Reports a request the portal failed. */
export type LogFailure = (doing: "hold" | "release", error: unknown) => void;

/**
 * One idle inhibitor that every bar toggles. A refused request leaves it as it
 * was, and is logged.
 */
export const idleInhibitor = (
  inhibit: () => Promise<Result<Release, SystemError>>,
  log: LogFailure = logFailure,
): IdleInhibitor => {
  const listeners = new Set<() => void>();
  const current: { state: State } = { state: State.Off() };
  const move = (state: State) => {
    current.state = state;
    for (const onChange of listeners) {
      onChange();
    }
  };
  return {
    current: () => current.state.at,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    toggle: () => {
      const { state } = current;
      switch (state.at) {
        case Inhibiting.Off: {
          move(State.Taking());
          inhibit()
            .then((held) => {
              held.match({
                Err: (error) => {
                  move(State.Off());
                  log("hold", error);
                },
                Ok: (release) => {
                  move(State.On(release));
                },
              });
            })
            .catch((error: unknown) => {
              log("hold", error);
            });
          break;
        }
        case Inhibiting.On: {
          move(State.Releasing(state.release));
          state
            .release()
            .then((released) => {
              released.match({
                Err: (error) => {
                  move(State.On(state.release));
                  log("release", error);
                },
                Ok: () => {
                  move(State.Off());
                },
              });
            })
            .catch((error: unknown) => {
              log("release", error);
            });
          break;
        }
        case Inhibiting.Taking:
        case Inhibiting.Releasing: {
          throw new Error("the idle inhibitor is still changing");
        }
      }
    },
  };
};

/** Where the inhibitor is, with what lets go of it while held. */
const State = {
  Off: () => ({ at: Inhibiting.Off as const }),
  On: (release: Release) => ({ at: Inhibiting.On as const, release }),
  Releasing: (release: Release) => ({
    at: Inhibiting.Releasing as const,
    release,
  }),
  Taking: () => ({ at: Inhibiting.Taking as const }),
};

type State = ReturnType<(typeof State)[keyof typeof State]>;

const logFailure: LogFailure = (doing, error) => {
  // biome-ignore lint/suspicious/noConsole: the bar has nowhere else to say it
  console.error(`could not ${doing} the idle inhibitor`, error);
};
