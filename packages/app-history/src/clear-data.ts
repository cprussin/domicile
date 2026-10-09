// What "Clear browsing data" removes, as `chrome.browsingData.remove` takes it.

/** How far back the dialog clears. */
export enum TimeRange {
  LastHour,
  LastDay,
  LastWeek,
  LastFourWeeks,
  AllTime,
}

/** The kinds of data the dialog offers to clear. */
export enum DataKind {
  History,
  Cookies,
  Cache,
  Downloads,
  FormData,
  Passwords,
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The data types each kind clears, in `DataTypeSet`'s names. */
const DATA_TYPES: Record<DataKind, readonly string[]> = {
  [DataKind.Cache]: ["cache"],
  [DataKind.Cookies]: [
    "cacheStorage",
    "cookies",
    "fileSystems",
    "indexedDB",
    "localStorage",
    "serviceWorkers",
    "webSQL",
  ],
  [DataKind.Downloads]: ["downloads"],
  [DataKind.FormData]: ["formData"],
  [DataKind.History]: ["history"],
  [DataKind.Passwords]: ["passwords"],
};

/** The time `range` starts at, as seen at `now`. */
export const since = (range: TimeRange, now: number): number => {
  switch (range) {
    case TimeRange.LastHour:
      return now - HOUR_MS;
    case TimeRange.LastDay:
      return now - DAY_MS;
    case TimeRange.LastWeek:
      return now - 7 * DAY_MS;
    case TimeRange.LastFourWeeks:
      return now - 28 * DAY_MS;
    case TimeRange.AllTime:
      return 0;
  }
};

/** The `dataToRemove` argument for `kinds`. */
export const dataToRemove = (
  kinds: ReadonlySet<DataKind>,
): Record<string, boolean> =>
  Object.fromEntries(
    [...kinds].flatMap((kind) => DATA_TYPES[kind].map((type) => [type, true])),
  );
