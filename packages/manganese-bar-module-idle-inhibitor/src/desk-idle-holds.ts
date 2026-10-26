import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Listening } from "@domicile-desktop/sdk/system";

/**
 * What the compositor calls a hold the shell took through the portal, like
 * this eye's own. See docs/IDLE.md.
 */
const SHELL = "domicile";

/**
 * What else holds the desk awake: the windows and applications with idle
 * inhibitors, watched once for every bar. Leaves out the shell's own hold,
 * which the eye shows as pressed. Failures are logged.
 */
export const deskIdleHolds = perHost(
  ({ session }: Pick<Domicile, "session">): SharedWatch<readonly string[]> =>
    sharedWatch((onHolders) => {
      const started = session.idleHolds().then((result) =>
        result.match<Listening<readonly string[]> | undefined>({
          Err: (error) => {
            logFailure(error);
            return undefined;
          },
          Ok: (listening) => {
            eachOf(listening.items, (holders) => {
              onHolders(holders.filter((holder) => holder !== SHELL));
            }).catch(logFailure);
            return listening;
          },
        }),
      );
      return () => {
        started
          .then((listening) => {
            listening?.stop();
          })
          .catch(logFailure);
      };
    }),
);

const logFailure = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the eye keeps showing the last holders it heard
  console.error("could not watch what holds the desk awake", error);
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
