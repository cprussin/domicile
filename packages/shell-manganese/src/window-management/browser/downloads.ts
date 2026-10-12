/** A page's downloads in progress. See `downloadCount` on `<webview>`. */
export type Downloads = {
  count: number;
  receivedBytes: number;
  /** `0` when any one's size is unknown. */
  totalBytes: number;
};
