// Shows a captive portal's sign-in page while the desk is on a network that
// has one. See docs/TOP-BAR.md.

import type { Option, Result } from "@cprussin/option-result";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Link, Network } from "@domicile-desktop/system-network/network";
import { LinkKind } from "@domicile-desktop/system-network/network";

/** How long to wait between checks while the sign-in page shows. */
const RECHECK_MS = 3000;

/** The longest wait after checks that got no answer, which double from {@link RECHECK_MS}. */
const MOST_PATIENCE_MS = 60_000;

type Options = {
  network: SharedWatch<Result<Network, SystemError>>;
  /** Where to sign in, or `None` for a network with no portal. */
  check: () => Promise<Result<Option<string>, SystemError>>;
  /** Called with the sign-in page to show, or `undefined` to hide it. */
  show: (url: string | undefined) => void;
  /** Hears a check that got no answer. */
  report: (error: SystemError) => void;
  /** Calls `then` after `ms`; returns what cancels it. */
  wait?: (ms: number, then: () => void) => () => void;
};

/** What {@link followPortals} returns. */
export type PortalWatch = {
  /** The user closed the sign-in page: stop checking until the next network. */
  dismiss: () => void;
  stop: () => void;
};

/**
 * Checks each network the desk joins for a captive portal, and shows its
 * sign-in page when there is one.
 *
 * A network is checked once on joining, so a signal change does not check it
 * again. While the page shows, the check repeats, and the page hides once the
 * portal lets the desk through or the desk leaves the network. A check that
 * gets no answer, such as one whose name lookup outlasts it, repeats too,
 * waiting longer each time, until one gets an answer.
 */
export const followPortals = ({
  check,
  network,
  report,
  show,
  wait = waitToRecheck,
}: Options): PortalWatch => {
  const state: FollowState = {
    cancel: undefined,
    name: undefined,
    round: 0,
    shown: false,
  };

  // Ends the current network's checks; a check still running is ignored.
  const forget = () => {
    state.round += 1;
    state.cancel?.();
    state.cancel = undefined;
  };

  const run = (round: number, unanswered: number) => {
    check()
      .then((checked) => {
        if (round === state.round) {
          checked.match({
            Err: (error) => {
              report(error);
              state.cancel = wait(
                Math.min(RECHECK_MS * 2 ** unanswered, MOST_PATIENCE_MS),
                () => {
                  run(round, unanswered + 1);
                },
              );
            },
            Ok: (portal) => {
              portal.match({
                None: () => {
                  if (state.shown) {
                    state.shown = false;
                    show(undefined);
                  }
                },
                Some: (url) => {
                  if (!state.shown) {
                    state.shown = true;
                    show(url);
                  }
                  state.cancel = wait(RECHECK_MS, () => {
                    run(round, 0);
                  });
                },
              });
            },
          });
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a background failure
        console.error("Failed to check for a captive portal", error);
      });
  };

  const unsubscribe = network.subscribe(() => {
    // A failed reading is the bar item's to show; the joined network stays.
    network.current()?.match({
      Err: () => undefined,
      Ok: ({ link }) => {
        const name = nameOf(link);
        if (name !== state.name) {
          state.name = name;
          forget();
          if (state.shown) {
            state.shown = false;
            show(undefined);
          }
          if (name !== undefined) {
            run(state.round, 0);
          }
        }
      },
    });
  });

  return {
    dismiss: () => {
      forget();
      state.shown = false;
    },
    stop: () => {
      forget();
      unsubscribe();
    },
  };
};

type FollowState = {
  /** Cancels the pending recheck. */
  cancel: (() => void) | undefined;
  /** The joined network, by {@link nameOf}. */
  name: string | undefined;
  /** Counts networks joined, so a check for one left behind is ignored. */
  round: number;
  /** Whether the sign-in page shows. */
  shown: boolean;
};

const waitToRecheck = (ms: number, then: () => void): (() => void) => {
  const timer = setTimeout(then, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** Which network `link` is, or `undefined` for none. */
const nameOf = (link: Link): string | undefined => {
  switch (link.kind) {
    case LinkKind.None: {
      return undefined;
    }
    case LinkKind.Wifi: {
      return `wifi:${link.ssid}`;
    }
    case LinkKind.Wired:
    case LinkKind.Other: {
      return `${LinkKind[link.kind]}:${link.name}`;
    }
  }
};
