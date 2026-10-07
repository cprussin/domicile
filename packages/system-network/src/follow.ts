// The loop each backend runs: listen, read, then read again on each signal
// that can change what was read.

import type { Result } from "@cprussin/option-result";
import { Err } from "@cprussin/option-result";
import type {
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";

import type { Network, NetworkSystem } from "./network-state";

/** What one read found, and which signals can change it. */
export type Reading = {
  network: Result<Network, SystemError>;
  matters: (signal: DbusSignal) => boolean;
};

/**
 * Calls `onNetwork` with what `read` finds now and after each signal that
 * matters, and returns a function that stops watching.
 */
export const followNetwork = (
  system: NetworkSystem,
  match: DbusMatch,
  read: () => Promise<Reading>,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { listening: undefined, stopped: false };
  const report = (network: Result<Network, SystemError>) => {
    if (!watch.stopped) {
      onNetwork(network);
    }
  };
  follow(system, match, read, watch, report).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: surfacing a background failure
    console.error("Failed to watch the network", error);
  });
  return () => {
    watch.stopped = true;
    watch.listening?.stop();
  };
};

/** A watch's state, shared by its loop and its stop function. */
type Watch = {
  listening: Listening<DbusSignal> | undefined;
  stopped: boolean;
};

const follow = async (
  system: NetworkSystem,
  match: DbusMatch,
  read: () => Promise<Reading>,
  watch: Watch,
  report: (network: Result<Network, SystemError>) => void,
): Promise<void> => {
  const matched = await system.dbusMatch(match);
  await matched.match({
    Err: (error) => {
      report(Err(error));
      return Promise.resolve();
    },
    Ok: async (listening) => {
      watch.listening = listening;
      if (watch.stopped) {
        listening.stop();
      }
      await changes(listening, read, report);
      const ended = await listening.ended;
      ended.match({
        Err: (error) => {
          report(Err(error));
        },
        Ok: () => {
          /* stopped by the caller */
        },
      });
    },
  });
};

/** Read now, and again on each signal that matters to the last read. */
const changes = async (
  listening: Listening<DbusSignal>,
  read: () => Promise<Reading>,
  report: (network: Result<Network, SystemError>) => void,
): Promise<void> => {
  const reader = listening.items.getReader();
  const first = await read();
  report(first.network);
  let matters = first.matters;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (matters(next.value)) {
      const again = await read();
      report(again.network);
      matters = again.matters;
    }
  }
};
