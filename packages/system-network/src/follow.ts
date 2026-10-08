// The loop each watch runs: listen, read, then read again on each signal that
// can change what was read.

import type { Result } from "@cprussin/option-result";
import { Err } from "@cprussin/option-result";
import type {
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";

import type { NetworkSystem } from "./network-state";

/** What one read found, and which signals can change it. */
export type Reading<T extends NonNullable<unknown>> = {
  value: Result<T, SystemError>;
  matters: (signal: DbusSignal) => boolean;
};

/**
 * Calls `onValue` with what `read` finds now and after each signal that
 * matters, and returns a function that stops watching.
 */
export const followBus = <T extends NonNullable<unknown>>(
  system: NetworkSystem,
  match: DbusMatch,
  read: () => Promise<Reading<T>>,
  onValue: (value: Result<T, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { listening: undefined, stopped: false };
  const report = (value: Result<T, SystemError>) => {
    if (!watch.stopped) {
      onValue(value);
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

const follow = async <T extends NonNullable<unknown>>(
  system: NetworkSystem,
  match: DbusMatch,
  read: () => Promise<Reading<T>>,
  watch: Watch,
  report: (value: Result<T, SystemError>) => void,
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
const changes = async <T extends NonNullable<unknown>>(
  listening: Listening<DbusSignal>,
  read: () => Promise<Reading<T>>,
  report: (value: Result<T, SystemError>) => void,
): Promise<void> => {
  const reader = listening.items.getReader();
  const first = await read();
  report(first.value);
  let matters = first.matters;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (matters(next.value)) {
      const again = await read();
      report(again.value);
      matters = again.matters;
    }
  }
};
