import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useCallback, useState } from "react";

/** What is in flight, and each request's last refusal. */
type State = {
  pending: ReadonlySet<string>;
  failed: ReadonlyMap<string, SystemError>;
};

/**
 * Requests to a system service, by key, for a panel that shows each one's
 * progress and refusal. The service's own state shows the outcome.
 */
export const useRequests = () => {
  const [state, setState] = useState<State>({
    failed: new Map(),
    pending: new Set(),
  });
  const run = useCallback(
    <T extends NonNullable<unknown>>(
      key: string,
      request: () => Promise<Result<T, SystemError>>,
    ) => {
      setState((was) => ({
        failed: without(was.failed, key),
        pending: new Set([...was.pending, key]),
      }));
      request().then(
        (result) => {
          setState((was) => ({
            failed: result.match({
              Err: (error) => new Map([...was.failed, [key, error]]),
              Ok: () => was.failed,
            }),
            pending: settled(was.pending, key),
          }));
        },
        (error: unknown) => {
          setState((was) => ({ ...was, pending: settled(was.pending, key) }));
          // biome-ignore lint/suspicious/noConsole: surfacing a background failure
          console.error(`Failed to send ${key}`, error);
        },
      );
    },
    [],
  );
  return {
    failed: (key: string): SystemError | undefined => state.failed.get(key),
    pending: (key: string): boolean => state.pending.has(key),
    run,
  };
};

const without = (
  failed: ReadonlyMap<string, SystemError>,
  key: string,
): ReadonlyMap<string, SystemError> =>
  new Map([...failed].filter(([other]) => other !== key));

const settled = (pending: ReadonlySet<string>, key: string) =>
  new Set([...pending].filter((other) => other !== key));
