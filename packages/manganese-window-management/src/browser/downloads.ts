/** A page's downloads. See `downloadCount` on `<webview>`. */
export type Downloads = {
  /** How many finished, until cleared. */
  completed: number;
  /** How many are in progress. */
  count: number;
  receivedBytes: number;
  /** `0` when any one in progress has an unknown size. */
  totalBytes: number;
};
