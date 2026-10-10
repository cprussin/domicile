/** What a row shows for where `url` is: its host without `www.`, or the URL. */
export const domain = (url: string): string => {
  const { hostname } = new URL(url);
  return hostname === "" ? url : hostname.replace(/^www\./u, "");
};
