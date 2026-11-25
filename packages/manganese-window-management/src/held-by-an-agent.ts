import type { Seat } from "@domicile-desktop/sdk/desktop/seats";

import { appIdOf, browserIdOf } from "./window";

/**
 * Whether an agent's seat holds window `id`. Seats name a client's window by
 * its app id and a browser window by the engine's id for it.
 */
export const heldByAnAgent = (
  seats: readonly Seat[] | undefined,
  id: string,
): boolean => {
  const named = appIdOf(id) ?? browserIdOf(id);
  return (
    named !== undefined &&
    (seats ?? []).some(({ holds }) => holds.includes(named))
  );
};
