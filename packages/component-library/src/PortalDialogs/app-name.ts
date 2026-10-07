/** How a dialog or indicator names an application. */
export const appName = (appId: string): string =>
  appId === "" ? "An application" : appId;
