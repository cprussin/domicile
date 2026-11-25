import type { Seat } from "@domicile-desktop/sdk/desktop/seats";

import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

/**
 * Every agent seat, following each that comes, goes, points or types;
 * `undefined` until the compositor says.
 */
export const useSeats = (): readonly Seat[] | undefined => {
  const { seats } = useDomicile();
  return useWatch(seats, "change", () => seats.list);
};
