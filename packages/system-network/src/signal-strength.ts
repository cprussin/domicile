/**
 * A Wi-Fi signal in dBm as 0 through 1, graded as NetworkManager grades it:
 * -100 dBm or weaker is 0, -40 dBm or stronger is 1.
 */
export const strengthOfDbm = (dbm: number): number =>
  (Math.min(Math.max(dbm, -100), -40) + 100) / 60;
