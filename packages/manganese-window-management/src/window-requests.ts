// Clients' maximize and fullscreen requests, which the compositor reports and
// the shell grants. See docs/WRITING-A-SHELL.md.

import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Listening } from "@domicile-desktop/sdk/system";
import type { WindowRequest } from "@domicile-desktop/sdk/window-state";

/**
 * Call `onRequest` with each window request a client makes, until `stop`. A
 * stop before listening starts ends it once it does.
 */
export const hearWindowRequests = (
  domicile: Domicile,
  onRequest: (request: WindowRequest) => void,
): { stop: () => void } => {
  const state: {
    stopped: boolean;
    listening: Listening<WindowRequest> | undefined;
  } = { listening: undefined, stopped: false };
  domicile.windows
    .requests()
    .then((result) => {
      result.match({
        Err: report,
        Ok: (listening) => {
          if (state.stopped) {
            listening.stop();
          } else {
            state.listening = listening;
          }
          eachOf(listening.items, onRequest).catch(report);
        },
      });
    })
    .catch(report);
  return {
    stop: () => {
      state.stopped = true;
      state.listening?.stop();
    },
  };
};

/** Call `each` with every item `items` brings, until it closes. */
const eachOf = async <T>(
  items: ReadableStream<T>,
  each: (item: T) => void,
): Promise<void> => {
  for await (const item of items) {
    each(item);
  }
};

const report = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: windows still work; only clients' fullscreen requests go unheard
  console.error("this page cannot hear window requests", error);
};
